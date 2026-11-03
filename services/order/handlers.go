package main

import (
	"database/sql"
	"errors"
	"log"
	"math"
	"time"

	"github.com/gin-gonic/gin"
)

type OrderItemInput struct {
	ProductID   string  `json:"productId"`
	ProductName string  `json:"productName"`
	UnitPrice   float64 `json:"unitPrice"`
	Quantity    int     `json:"quantity"`
}

type OrderItem struct {
	ProductID   string  `json:"productId"`
	ProductName string  `json:"productName"`
	UnitPrice   float64 `json:"unitPrice"`
	Quantity    int     `json:"quantity"`
}

type Order struct {
	ID          string      `json:"id"`
	UserID      string      `json:"userId"`
	Status      string      `json:"status"`
	TotalAmount float64     `json:"totalAmount"`
	Items       []OrderItem `json:"items,omitempty"`
	CreatedAt   time.Time   `json:"createdAt,omitempty"`
	UpdatedAt   time.Time   `json:"updatedAt,omitempty"`
}

// CalculateTotal is a pure function: sum(unitPrice*quantity), rounded to cents.
func CalculateTotal(items []OrderItemInput) float64 {
	var t float64
	for _, it := range items {
		t += it.UnitPrice * float64(it.Quantity)
	}
	return math.Round(t*100) / 100
}

// ValidateCreateOrder is pure validation for order creation.
func ValidateCreateOrder(items []OrderItemInput) error {
	if len(items) == 0 {
		return errors.New("items must not be empty")
	}
	for _, it := range items {
		if it.ProductID == "" {
			return errors.New("productId is required")
		}
		if it.Quantity <= 0 {
			return errors.New("quantity must be > 0")
		}
		if it.UnitPrice < 0 {
			return errors.New("unitPrice must be >= 0")
		}
	}
	return nil
}

// CanCancel encodes the allowed cancel source statuses.
func CanCancel(status string) bool { return status == "PENDING" || status == "CONFIRMED" }

// ValidTransition encodes allowed order status transitions.
func ValidTransition(from, to string) bool {
	if from == to {
		return true
	}
	switch from {
	case "PENDING":
		return to == "CONFIRMED" || to == "CANCELLED" || to == "PAYMENT_FAILED"
	case "CONFIRMED":
		return to == "CANCELLED"
	default:
		return false
	}
}

func (a *App) updateStatus(id, status string) error {
	_, err := a.DB.Exec(`UPDATE orders SET status=$1, updated_at=NOW() WHERE id=$2`, status, id)
	return err
}

func (a *App) loadOrder(id string) (*Order, error) {
	var o Order
	err := a.DB.QueryRow(`SELECT id, user_id, status, total_amount, created_at, updated_at FROM orders WHERE id=$1`, id).Scan(&o.ID, &o.UserID, &o.Status, &o.TotalAmount, &o.CreatedAt, &o.UpdatedAt)
	if err != nil {
		return nil, err
	}
	rows, err := a.DB.Query(`SELECT product_id, product_name_snapshot, unit_price_snapshot, quantity FROM order_items WHERE order_id=$1`, id)
	if err == nil {
		defer rows.Close()
		o.Items = []OrderItem{}
		for rows.Next() {
			var it OrderItem
			if err := rows.Scan(&it.ProductID, &it.ProductName, &it.UnitPrice, &it.Quantity); err == nil {
				o.Items = append(o.Items, it)
			}
		}
	}
	if o.Items == nil {
		o.Items = []OrderItem{}
	}
	return &o, nil
}

func (a *App) publish(eventType string, o Order, c *gin.Context) {
	if a.Events == nil {
		return
	}
	corr := ""
	if c != nil {
		corr = c.GetHeader("X-Correlation-ID")
	}
	a.Events.Publish(eventType, o, corr)
}

func (a *App) CreateOrder(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	userID := c.GetString("userId")
	var body struct {
		Items        []OrderItemInput `json:"items"`
		PaymentToken string           `json:"paymentToken"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeError(c, 400, "VALIDATION_ERROR", "invalid JSON body")
		return
	}
	if err := ValidateCreateOrder(body.Items); err != nil {
		writeError(c, 400, "VALIDATION_ERROR", err.Error())
		return
	}
	// Authoritative pricing: never trust client-sent names/prices (ADR: price hardening).
	// The catalog name/price replace whatever the client sent and become the snapshot.
	if a.Product != nil && a.Product.BaseURL != "" {
		for i, it := range body.Items {
			name, price, err := a.Product.Lookup(it.ProductID)
			if errors.Is(err, ErrProductNotFound) {
				writeError(c, 400, "PRODUCT_NOT_FOUND", "product not found: "+it.ProductID)
				return
			}
			if err != nil {
				log.Printf("product lookup failed for %s: %v", it.ProductID, err)
				writeError(c, 502, "PRODUCT_UNAVAILABLE", "product catalog unavailable")
				return
			}
			body.Items[i].ProductName = name
			body.Items[i].UnitPrice = price
		}
	}
	total := CalculateTotal(body.Items)
	o := Order{ID: newID(), UserID: userID, Status: "PENDING", TotalAmount: total, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	for _, it := range body.Items {
		o.Items = append(o.Items, OrderItem(it))
	}

	tx, err := a.DB.Begin()
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	if _, err := tx.Exec(`INSERT INTO orders(id, user_id, status, total_amount) VALUES($1,$2,'PENDING',$3)`, o.ID, o.UserID, o.TotalAmount); err != nil {
		tx.Rollback()
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	for _, it := range body.Items {
		if _, err := tx.Exec(`INSERT INTO order_items(id, order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity) VALUES($1,$2,$3,$4,$5,$6)`, newID(), o.ID, it.ProductID, it.ProductName, it.UnitPrice, it.Quantity); err != nil {
			tx.Rollback()
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
	}
	if err := tx.Commit(); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	a.publish("OrderCreated", o, c)

	// Reserve inventory item-by-item.
	for _, it := range body.Items {
		if err := a.Inventory.Reserve(o.ID, it.ProductID, it.Quantity); err != nil {
			_ = a.Inventory.Release(o.ID)
			_ = a.updateStatus(o.ID, "CANCELLED")
			o.Status = "CANCELLED"
			a.publish("OrderCancelled", o, c)
			// Reservation failures are surfaced as INSUFFICIENT_STOCK per spec.
			log.Printf("reservation failed for order %s: %v (insufficient=%v)", o.ID, err, errors.Is(err, ErrInsufficientStock))
			c.JSON(409, gin.H{"error": gin.H{"code": "INSUFFICIENT_STOCK", "message": "insufficient stock"}, "orderId": o.ID, "order": o})
			return
		}
	}

	// Pay.
	pay, err := a.Payment.Pay(o.ID, userID, total, body.PaymentToken, o.ID)
	if err != nil || pay == nil || pay.Status == "FAILED" {
		if err != nil {
			log.Printf("payment call failed for order %s: %v", o.ID, err)
		}
		_ = a.Inventory.Release(o.ID)
		_ = a.updateStatus(o.ID, "PAYMENT_FAILED")
		o.Status = "PAYMENT_FAILED"
		a.publish("PaymentFailed", o, c)
		c.JSON(201, o)
		return
	}
	// SUCCEEDED
	if err := a.Inventory.Confirm(o.ID); err != nil {
		log.Printf("confirm reservations failed for order %s: %v (continuing)", o.ID, err)
	}
	_ = a.updateStatus(o.ID, "CONFIRMED")
	o.Status = "CONFIRMED"
	a.publish("PaymentSucceeded", o, c)
	a.publish("OrderConfirmed", o, c)
	c.JSON(201, o)
}

func (a *App) ListOrders(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	userID := c.GetString("userId")
	rows, err := a.DB.Query(`SELECT id FROM orders WHERE user_id=$1 ORDER BY created_at DESC`, userID)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	var ids []string
	for rows.Next() {
		var id string
		_ = rows.Scan(&id)
		ids = append(ids, id)
	}
	rows.Close()
	orders := []Order{}
	for _, id := range ids {
		if o, err := a.loadOrder(id); err == nil {
			orders = append(orders, *o)
		}
	}
	c.JSON(200, orders)
}

func (a *App) GetOrder(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	o, err := a.loadOrder(c.Param("id"))
	if err == sql.ErrNoRows {
		writeError(c, 404, "NOT_FOUND", "order not found")
		return
	}
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	if o.UserID != c.GetString("userId") && c.GetString("role") != "ADMIN" {
		writeError(c, 403, "FORBIDDEN", "not your order")
		return
	}
	c.JSON(200, o)
}

func (a *App) CancelOrder(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	o, err := a.loadOrder(c.Param("id"))
	if err == sql.ErrNoRows {
		writeError(c, 404, "NOT_FOUND", "order not found")
		return
	}
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	if o.UserID != c.GetString("userId") {
		writeError(c, 403, "FORBIDDEN", "not your order")
		return
	}
	if !CanCancel(o.Status) {
		writeError(c, 409, "INVALID_ORDER_STATUS", "order cannot be cancelled in status "+o.Status)
		return
	}
	if o.Status == "PENDING" {
		_ = a.Inventory.Release(o.ID)
	}
	if o.Status == "CONFIRMED" {
		// Stock was already deducted on confirm; return it.
		for _, it := range o.Items {
			_ = a.Inventory.Restock(it.ProductID, it.Quantity)
		}
	}
	_ = a.updateStatus(o.ID, "CANCELLED")
	o.Status = "CANCELLED"
	a.publish("OrderCancelled", *o, c)
	c.JSON(200, o)
}

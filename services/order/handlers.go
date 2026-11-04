package main

import (
	"database/sql"
	"errors"
	"log"
	"math"
	"strings"
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

type ShippingInfo struct {
	RecipientName string `json:"recipientName"`
	Phone         string `json:"phone"`
	AddressLine   string `json:"addressLine"`
	City          string `json:"city"`
	Note          string `json:"note"`
	Method        string `json:"method"`
}

type Order struct {
	ID             string       `json:"id"`
	UserID         string       `json:"userId"`
	Status         string       `json:"status"`
	TotalAmount    float64      `json:"totalAmount"`
	Subtotal       float64      `json:"subtotal"`
	ShippingFee    float64      `json:"shippingFee"`
	DiscountAmount float64      `json:"discountAmount"`
	CouponCode     string       `json:"couponCode"`
	Shipping       ShippingInfo `json:"shipping"`
	Items          []OrderItem  `json:"items,omitempty"`
	CreatedAt      time.Time    `json:"createdAt,omitempty"`
	UpdatedAt      time.Time    `json:"updatedAt,omitempty"`
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

// NormalizeShippingMethod defaults empty to STANDARD and upper-cases.
func NormalizeShippingMethod(m string) string {
	m = strings.ToUpper(strings.TrimSpace(m))
	if m == "" {
		return "STANDARD"
	}
	return m
}

// ValidateShipping requires recipientName/phone/addressLine/city, naming the field.
func ValidateShipping(s ShippingInfo) error {
	switch {
	case strings.TrimSpace(s.RecipientName) == "":
		return errors.New("recipientName is required")
	case strings.TrimSpace(s.Phone) == "":
		return errors.New("phone is required")
	case strings.TrimSpace(s.AddressLine) == "":
		return errors.New("addressLine is required")
	case strings.TrimSpace(s.City) == "":
		return errors.New("city is required")
	}
	if _, err := ShippingFee(s.Method, 0); err != nil {
		return err
	}
	return nil
}

// ComputeDiscount is coupon math: round2(subtotal * percent/100).
func ComputeDiscount(subtotal float64, percent int) float64 {
	return round2(subtotal * float64(percent) / 100)
}

var ErrInvalidCoupon = errors.New("invalid coupon")

// DiscountForCoupon is the pure coupon-lookup decision: not found or
// inactive (or a non-sane percent) is an invalid coupon.
func DiscountForCoupon(subtotal float64, percent int, found, active bool) (float64, error) {
	if !found || !active || percent <= 0 || percent > 100 {
		return 0, ErrInvalidCoupon
	}
	return ComputeDiscount(subtotal, percent), nil
}

// ShippingFee: STANDARD free at net >= 75 else 4.99; EXPRESS flat 12.99.
func ShippingFee(method string, net float64) (float64, error) {
	switch NormalizeShippingMethod(method) {
	case "STANDARD":
		if net >= 75 {
			return 0, nil
		}
		return 4.99, nil
	case "EXPRESS":
		return 12.99, nil
	default:
		return 0, errors.New("method is invalid: unknown shipping method")
	}
}

type Pricing struct {
	Subtotal    float64
	Discount    float64
	ShippingFee float64
	Total       float64
}

// CalculatePricing combines discount + shipping fee into the final total.
func CalculatePricing(goodsSubtotal, discount float64, method string) (Pricing, error) {
	fee, err := ShippingFee(method, goodsSubtotal-discount)
	if err != nil {
		return Pricing{}, err
	}
	return Pricing{
		Subtotal:    round2(goodsSubtotal),
		Discount:    round2(discount),
		ShippingFee: fee,
		Total:       round2(goodsSubtotal - discount + fee),
	}, nil
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
// It is the single source of truth; terminal states (DELIVERED,
// CANCELLED, PAYMENT_FAILED) have no outgoing transitions.
func ValidTransition(from, to string) bool {
	switch from {
	case "PENDING":
		return to == "CONFIRMED" || to == "CANCELLED" || to == "PAYMENT_FAILED"
	case "CONFIRMED":
		return to == "PROCESSING" || to == "CANCELLED"
	case "PROCESSING":
		return to == "SHIPPED" || to == "CANCELLED"
	case "SHIPPED":
		return to == "DELIVERED"
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
	err := a.DB.QueryRow(`SELECT id, user_id, status, total_amount, COALESCE(subtotal,0), COALESCE(shipping_fee,0), COALESCE(discount_amount,0), COALESCE(coupon_code,''), COALESCE(recipient_name,''), COALESCE(phone,''), COALESCE(address_line,''), COALESCE(city,''), COALESCE(note,''), COALESCE(shipping_method,'STANDARD'), created_at, updated_at FROM orders WHERE id=$1`, id).Scan(&o.ID, &o.UserID, &o.Status, &o.TotalAmount, &o.Subtotal, &o.ShippingFee, &o.DiscountAmount, &o.CouponCode, &o.Shipping.RecipientName, &o.Shipping.Phone, &o.Shipping.AddressLine, &o.Shipping.City, &o.Shipping.Note, &o.Shipping.Method, &o.CreatedAt, &o.UpdatedAt)
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

// resolveIdempotencyKey prefers the Idempotency-Key header, then the body field.
func resolveIdempotencyKey(header, body string) string {
	if header != "" {
		return header
	}
	return body
}

func (a *App) findOrderByIdempotency(userID, key string) (*Order, error) {
	var id string
	err := a.DB.QueryRow(`SELECT id FROM orders WHERE user_id=$1 AND idempotency_key=$2`, userID, key).Scan(&id)
	if err != nil {
		return nil, err
	}
	return a.loadOrder(id)
}

func (a *App) CreateOrder(c *gin.Context) {
	userID := c.GetString("userId")
	var body struct {
		Items          []OrderItemInput `json:"items"`
		PaymentToken   string           `json:"paymentToken"`
		IdempotencyKey string           `json:"idempotencyKey"`
		Shipping       ShippingInfo     `json:"shipping"`
		CouponCode     string           `json:"couponCode"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeError(c, 400, "VALIDATION_ERROR", "invalid JSON body")
		return
	}
	// Pure validation before any DB/side effects.
	if err := ValidateCreateOrder(body.Items); err != nil {
		writeError(c, 400, "VALIDATION_ERROR", err.Error())
		return
	}
	if err := ValidateShipping(body.Shipping); err != nil {
		writeError(c, 400, "VALIDATION_ERROR", err.Error())
		return
	}
	body.Shipping.Method = NormalizeShippingMethod(body.Shipping.Method)
	body.CouponCode = strings.TrimSpace(body.CouponCode)
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	idempotencyKey := resolveIdempotencyKey(c.GetHeader("Idempotency-Key"), body.IdempotencyKey)
	// Idempotent replay: return before any reservation/payment side effects.
	if idempotencyKey != "" {
		if existing, err := a.findOrderByIdempotency(userID, idempotencyKey); err == nil {
			c.JSON(200, existing)
			return
		} else if err != sql.ErrNoRows {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
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
	goodsSubtotal := CalculateTotal(body.Items)
	// Coupon lookup (server-side only).
	var discount float64
	if body.CouponCode != "" {
		var percent int
		var active bool
		err := a.DB.QueryRow(`SELECT percent, COALESCE(active,true) FROM coupons WHERE code=$1`, body.CouponCode).Scan(&percent, &active)
		found := err == nil
		if err != nil && err != sql.ErrNoRows {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		d, err := DiscountForCoupon(goodsSubtotal, percent, found, active)
		if err != nil {
			writeError(c, 400, "INVALID_COUPON", "invalid coupon: "+body.CouponCode)
			return
		}
		discount = d
	}
	pricing, err := CalculatePricing(goodsSubtotal, discount, body.Shipping.Method)
	if err != nil {
		writeError(c, 400, "VALIDATION_ERROR", err.Error())
		return
	}
	total := pricing.Total
	o := Order{ID: newID(), UserID: userID, Status: "PENDING", TotalAmount: pricing.Total, Subtotal: pricing.Subtotal, ShippingFee: pricing.ShippingFee, DiscountAmount: pricing.Discount, CouponCode: body.CouponCode, Shipping: body.Shipping, CreatedAt: time.Now().UTC(), UpdatedAt: time.Now().UTC()}
	for _, it := range body.Items {
		o.Items = append(o.Items, OrderItem(it))
	}

	tx, err := a.DB.Begin()
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	var keyArg interface{}
	if idempotencyKey != "" {
		keyArg = idempotencyKey
	}
	var couponArg interface{}
	if o.CouponCode != "" {
		couponArg = o.CouponCode
	}
	if _, err := tx.Exec(`INSERT INTO orders(id, user_id, status, total_amount, idempotency_key, recipient_name, phone, address_line, city, note, shipping_method, shipping_fee, subtotal, coupon_code, discount_amount) VALUES($1,$2,'PENDING',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`, o.ID, o.UserID, o.TotalAmount, keyArg, o.Shipping.RecipientName, o.Shipping.Phone, o.Shipping.AddressLine, o.Shipping.City, o.Shipping.Note, o.Shipping.Method, o.ShippingFee, o.Subtotal, couponArg, o.DiscountAmount); err != nil {
		tx.Rollback()
		// Unique-violation race on (user_id, idempotency_key): return winner.
		if idempotencyKey != "" {
			if existing, e2 := a.findOrderByIdempotency(userID, idempotencyKey); e2 == nil {
				c.JSON(200, existing)
				return
			}
		}
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
		if idempotencyKey != "" {
			if existing, e2 := a.findOrderByIdempotency(userID, idempotencyKey); e2 == nil {
				c.JSON(200, existing)
				return
			}
		}
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
	refunded := false
	if o.Status == "CONFIRMED" {
		// Refund first; failure is logged but does not block cancellation.
		if _, err := a.Payment.Refund(o.ID); err != nil {
			log.Printf("refund failed for order %s: %v (continuing cancel)", o.ID, err)
		} else {
			refunded = true
		}
		// Stock was already deducted on confirm; return it.
		for _, it := range o.Items {
			_ = a.Inventory.Restock(o.ID, it.ProductID, it.Quantity)
		}
	}
	_ = a.updateStatus(o.ID, "CANCELLED")
	o.Status = "CANCELLED"
	if refunded {
		a.publish("PaymentRefunded", *o, c)
	}
	a.publish("OrderCancelled", *o, c)
	c.JSON(200, o)
}

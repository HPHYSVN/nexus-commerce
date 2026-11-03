package main

import (
	"database/sql"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
)

// Available computes available stock.
func Available(quantity, reserved int) int { return quantity - reserved }

// CanReserve is the pure atomic-availability predicate mirrored by the SQL UPDATE.
func CanReserve(quantity, reserved, requested int) bool {
	if requested <= 0 {
		return false
	}
	return quantity-reserved >= requested
}

func validateReservation(orderID, productID string, qty int) bool {
	return orderID != "" && productID != "" && qty > 0
}

type stockResp struct {
	ProductID string `json:"productId"`
	Quantity  int    `json:"quantity"`
	Reserved  int    `json:"reserved"`
	Available int    `json:"available"`
}

func (a *App) GetStock(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	pid := c.Param("productId")
	var q, r int
	err := a.DB.QueryRow(`SELECT quantity, reserved FROM stock_items WHERE product_id=$1`, pid).Scan(&q, &r)
	if err == sql.ErrNoRows {
		writeError(c, 404, "NOT_FOUND", "stock item not found")
		return
	}
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	c.JSON(200, stockResp{pid, q, r, Available(q, r)})
}

func (a *App) PutStock(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	pid := c.Param("productId")
	var body struct {
		Quantity *int `json:"quantity"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.Quantity == nil || *body.Quantity < 0 {
		writeError(c, 400, "VALIDATION_ERROR", "quantity must be >= 0")
		return
	}
	_, err := a.DB.Exec(`INSERT INTO stock_items(product_id, quantity, reserved) VALUES($1,$2,0) ON CONFLICT(product_id) DO UPDATE SET quantity=EXCLUDED.quantity`, pid, *body.Quantity)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	var q, r int
	_ = a.DB.QueryRow(`SELECT quantity, reserved FROM stock_items WHERE product_id=$1`, pid).Scan(&q, &r)
	c.JSON(200, stockResp{pid, q, r, Available(q, r)})
}

type reservation struct {
	ID        string    `json:"id"`
	ProductID string    `json:"productId"`
	OrderID   string    `json:"orderId"`
	Quantity  int       `json:"quantity"`
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"createdAt,omitempty"`
}

func (a *App) CreateReservation(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	var body struct {
		OrderID   string `json:"orderId"`
		ProductID string `json:"productId"`
		Quantity  int    `json:"quantity"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || !validateReservation(body.OrderID, body.ProductID, body.Quantity) {
		writeError(c, 400, "VALIDATION_ERROR", "orderId, productId and quantity>0 are required")
		return
	}
	tx, err := a.DB.Begin()
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	defer tx.Rollback()

	// Idempotent on (order_id, product_id) if ACTIVE exists.
	var existing reservation
	err = tx.QueryRow(`SELECT id, product_id, order_id, quantity, status, created_at FROM reservations WHERE order_id=$1 AND product_id=$2 AND status='ACTIVE'`, body.OrderID, body.ProductID).Scan(&existing.ID, &existing.ProductID, &existing.OrderID, &existing.Quantity, &existing.Status, &existing.CreatedAt)
	if err == nil {
		_ = tx.Commit()
		c.JSON(200, existing)
		return
	}
	if err != sql.ErrNoRows {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}

	// Atomic reservation.
	res, err := tx.Exec(`UPDATE stock_items SET reserved=reserved+$1 WHERE product_id=$2 AND quantity-reserved>=$1`, body.Quantity, body.ProductID)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		writeError(c, http.StatusConflict, "INSUFFICIENT_STOCK", "insufficient stock")
		return
	}
	r := reservation{ID: newID(), ProductID: body.ProductID, OrderID: body.OrderID, Quantity: body.Quantity, Status: "ACTIVE", CreatedAt: time.Now().UTC()}
	// Handle race / previously RELEASED/CONFIRMED row with same unique key: reactivate it.
	_, err = tx.Exec(`INSERT INTO reservations(id, product_id, order_id, quantity, status) VALUES($1,$2,$3,$4,'ACTIVE') ON CONFLICT(order_id, product_id) DO UPDATE SET quantity=EXCLUDED.quantity, status='ACTIVE', id=EXCLUDED.id, created_at=NOW()`, r.ID, r.ProductID, r.OrderID, r.Quantity)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	c.JSON(201, r)
}

// Restock returns units to available stock (used when a CONFIRMED order is cancelled).
func (a *App) Restock(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	var body struct {
		ProductID string `json:"productId"`
		Quantity  int    `json:"quantity"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || body.ProductID == "" || body.Quantity <= 0 {
		writeError(c, 400, "VALIDATION_ERROR", "productId and quantity>0 are required")
		return
	}
	if _, err := a.DB.Exec(`INSERT INTO stock_items(product_id, quantity, reserved) VALUES($1,$2,0) ON CONFLICT(product_id) DO UPDATE SET quantity=stock_items.quantity+EXCLUDED.quantity`, body.ProductID, body.Quantity); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	var q, r int
	_ = a.DB.QueryRow(`SELECT quantity, reserved FROM stock_items WHERE product_id=$1`, body.ProductID).Scan(&q, &r)
	c.JSON(200, stockResp{body.ProductID, q, r, Available(q, r)})
}

func (a *App) ReleaseReservations(c *gin.Context) { a.transition(c, "RELEASED") }
func (a *App) ConfirmReservations(c *gin.Context) { a.transition(c, "CONFIRMED") }

func (a *App) transition(c *gin.Context, target string) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	orderID := c.Param("orderId")
	tx, err := a.DB.Begin()
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT product_id, quantity FROM reservations WHERE order_id=$1 AND status='ACTIVE'`, orderID)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	type item struct {
		pid string
		qty int
	}
	var items []item
	for rows.Next() {
		var it item
		if err := rows.Scan(&it.pid, &it.qty); err != nil {
			rows.Close()
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		items = append(items, it)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	for _, it := range items {
		if target == "RELEASED" {
			_, err = tx.Exec(`UPDATE stock_items SET reserved=GREATEST(reserved-$1,0) WHERE product_id=$2`, it.qty, it.pid)
		} else {
			_, err = tx.Exec(`UPDATE stock_items SET reserved=GREATEST(reserved-$1,0), quantity=GREATEST(quantity-$1,0) WHERE product_id=$2`, it.qty, it.pid)
		}
		if err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
	}
	if _, err := tx.Exec(`UPDATE reservations SET status=$1 WHERE order_id=$2 AND status='ACTIVE'`, target, orderID); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	if err := tx.Commit(); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	key := "released"
	if target == "CONFIRMED" {
		key = "confirmed"
	}
	c.JSON(200, gin.H{"orderId": orderID, "status": target, key: len(items), "count": len(items)})
}

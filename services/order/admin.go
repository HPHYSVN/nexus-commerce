package main

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"
)

// requireAdmin must run after requireAuth (which sets "role").
// It rejects non-ADMIN callers with 403 before any handler/DB access.
func (a *App) requireAdmin(c *gin.Context) {
	if c.GetString("role") != "ADMIN" {
		writeError(c, 403, "FORBIDDEN", "admin role required")
		c.Abort()
		return
	}
	c.Next()
}

// adminAllowedTransitions is the subset of ValidTransition an admin may
// trigger via PUT /admin/orders/:id/status. ValidTransition remains the
// single source of truth for overall transition legality; a transition
// must be in both sets to be accepted here.
var adminAllowedTransitions = map[string]map[string]bool{
	"CONFIRMED":  {"PROCESSING": true, "CANCELLED": true},
	"PROCESSING": {"SHIPPED": true, "CANCELLED": true},
	"SHIPPED":    {"DELIVERED": true},
}

func adminTransitionAllowed(from, to string) bool {
	next, ok := adminAllowedTransitions[from]
	return ok && next[to] && ValidTransition(from, to)
}

func parsePagination(c *gin.Context) (page, size int) {
	page, size = 1, 20
	if v, err := strconv.Atoi(c.Query("page")); err == nil && v > 0 {
		page = v
	}
	if v, err := strconv.Atoi(c.Query("size")); err == nil && v > 0 {
		size = v
	}
	if size > 100 {
		size = 100
	}
	return page, size
}

// AdminListOrders lists all orders newest-first with items.
// Uses two queries total: one for the page of orders, one for all
// items of those orders (no N+1).
func (a *App) AdminListOrders(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	page, size := parsePagination(c)
	status := c.Query("status")

	var total int64
	var orders []Order
	if status != "" {
		if err := a.DB.QueryRow(`SELECT COUNT(*) FROM orders WHERE status=$1`, status).Scan(&total); err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		rows, err := a.DB.Query(`SELECT id, user_id, status, total_amount, COALESCE(subtotal,0), COALESCE(shipping_fee,0), COALESCE(discount_amount,0), COALESCE(coupon_code,''), COALESCE(recipient_name,''), COALESCE(phone,''), COALESCE(address_line,''), COALESCE(city,''), COALESCE(note,''), COALESCE(shipping_method,'STANDARD'), created_at, updated_at FROM orders WHERE status=$1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`, status, size, (page-1)*size)
		if err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		defer rows.Close()
		orders, err = scanOrders(rows)
		rows.Close()
		if err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
	} else {
		if err := a.DB.QueryRow(`SELECT COUNT(*) FROM orders`).Scan(&total); err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		rows, err := a.DB.Query(`SELECT id, user_id, status, total_amount, COALESCE(subtotal,0), COALESCE(shipping_fee,0), COALESCE(discount_amount,0), COALESCE(coupon_code,''), COALESCE(recipient_name,''), COALESCE(phone,''), COALESCE(address_line,''), COALESCE(city,''), COALESCE(note,''), COALESCE(shipping_method,'STANDARD'), created_at, updated_at FROM orders ORDER BY created_at DESC, id DESC LIMIT $1 OFFSET $2`, size, (page-1)*size)
		if err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		defer rows.Close()
		orders, err = scanOrders(rows)
		rows.Close()
		if err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
	}
	if orders == nil {
		orders = []Order{}
	}
	if err := a.loadItemsForOrders(orders); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	c.Header("X-Total-Count", strconv.FormatInt(total, 10))
	c.JSON(200, orders)
}

func scanOrders(rows *sql.Rows) ([]Order, error) {
	orders := []Order{}
	for rows.Next() {
		var o Order
		if err := rows.Scan(&o.ID, &o.UserID, &o.Status, &o.TotalAmount, &o.Subtotal, &o.ShippingFee, &o.DiscountAmount, &o.CouponCode, &o.Shipping.RecipientName, &o.Shipping.Phone, &o.Shipping.AddressLine, &o.Shipping.City, &o.Shipping.Note, &o.Shipping.Method, &o.CreatedAt, &o.UpdatedAt); err != nil {
			return nil, err
		}
		o.Items = []OrderItem{}
		orders = append(orders, o)
	}
	return orders, rows.Err()
}

// loadItemsForOrders fills Items for every order with a single IN query.
func (a *App) loadItemsForOrders(orders []Order) error {
	if len(orders) == 0 {
		return nil
	}
	placeholders := make([]string, len(orders))
	args := make([]interface{}, len(orders))
	idx := make(map[string]int, len(orders))
	for i, o := range orders {
		placeholders[i] = fmt.Sprintf("$%d", i+1)
		args[i] = o.ID
		idx[o.ID] = i
	}
	rows, err := a.DB.Query(`SELECT order_id, product_id, product_name_snapshot, unit_price_snapshot, quantity FROM order_items WHERE order_id IN (`+strings.Join(placeholders, ",")+`)`, args...)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var orderID string
		var it OrderItem
		if err := rows.Scan(&orderID, &it.ProductID, &it.ProductName, &it.UnitPrice, &it.Quantity); err != nil {
			return err
		}
		if i, ok := idx[orderID]; ok {
			orders[i].Items = append(orders[i].Items, it)
		}
	}
	return rows.Err()
}

type revenueByDayEntry struct {
	Date    string  `json:"date"`
	Revenue float64 `json:"revenue"`
	Orders  int64   `json:"orders"`
}

type adminStats struct {
	TotalOrders    int64               `json:"totalOrders"`
	TotalRevenue   float64             `json:"totalRevenue"`
	OrdersByStatus map[string]int64    `json:"ordersByStatus"`
	RevenueByDay   []revenueByDayEntry `json:"revenueByDay"`
}

// revenueStatuses are the statuses counted towards revenue.
const revenueStatuses = `('CONFIRMED','PROCESSING','SHIPPED','DELIVERED')`

func (a *App) AdminStats(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	stats := adminStats{OrdersByStatus: map[string]int64{}, RevenueByDay: []revenueByDayEntry{}}
	if err := a.DB.QueryRow(`SELECT COUNT(*) FROM orders`).Scan(&stats.TotalOrders); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	if err := a.DB.QueryRow(`SELECT COALESCE(SUM(total_amount),0) FROM orders WHERE status IN ` + revenueStatuses).Scan(&stats.TotalRevenue); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	rows, err := a.DB.Query(`SELECT status, COUNT(*) FROM orders GROUP BY status`)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	for rows.Next() {
		var s string
		var n int64
		if err := rows.Scan(&s, &n); err != nil {
			rows.Close()
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		stats.OrdersByStatus[s] = n
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	rows.Close()

	dayRows, err := a.DB.Query(`SELECT to_char((created_at AT TIME ZONE 'UTC')::date, 'YYYY-MM-DD') AS day, COALESCE(SUM(total_amount),0), COUNT(*) FROM orders WHERE status IN ` + revenueStatuses + ` AND created_at >= NOW() - INTERVAL '30 days' GROUP BY day ORDER BY day ASC`)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	defer dayRows.Close()
	for dayRows.Next() {
		var e revenueByDayEntry
		if err := dayRows.Scan(&e.Date, &e.Revenue, &e.Orders); err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		stats.RevenueByDay = append(stats.RevenueByDay, e)
	}
	if err := dayRows.Err(); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	c.JSON(200, stats)
}

func (a *App) AdminUpdateOrderStatus(c *gin.Context) {
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
	var body struct {
		Status string `json:"status"`
	}
	if err := c.ShouldBindJSON(&body); err != nil {
		writeError(c, 400, "VALIDATION_ERROR", "invalid JSON body")
		return
	}
	prev := o.Status
	if !adminTransitionAllowed(prev, body.Status) {
		writeError(c, 409, "INVALID_TRANSITION", "cannot transition order from "+prev+" to "+body.Status)
		return
	}
	refunded := false
	if body.Status == "CANCELLED" {
		// prev is CONFIRMED or PROCESSING (only cancellable admin sources):
		// payment was taken and stock already deducted, so compensate like
		// the customer-cancel path. Failures are logged, never blocking.
		if _, err := a.Payment.Refund(o.ID); err != nil {
			log.Printf("refund failed for order %s: %v (continuing admin cancel)", o.ID, err)
		} else {
			refunded = true
		}
		for _, it := range o.Items {
			if err := a.Inventory.Restock(o.ID, it.ProductID, it.Quantity); err != nil {
				log.Printf("restock failed for order %s product %s: %v (continuing admin cancel)", o.ID, it.ProductID, err)
			}
		}
	}
	if err := a.updateStatus(o.ID, body.Status); err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	o.Status = body.Status
	if body.Status == "CANCELLED" {
		if refunded {
			a.publish("PaymentRefunded", *o, c)
		}
		a.publish("OrderCancelled", *o, c)
	}
	c.JSON(200, o)
}

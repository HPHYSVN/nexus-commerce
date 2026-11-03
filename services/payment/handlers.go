package main

import (
	"database/sql"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
)

// DecideStatus is the pure mock-provider decision function.
func DecideStatus(paymentToken string) string {
	if paymentToken == "tok_fail" {
		return "FAILED"
	}
	return "SUCCEEDED"
}

// ValidatePaymentRequest is pure validation for CreatePayment.
func ValidatePaymentRequest(orderID, userID, idempotencyKey string, amount float64) bool {
	return orderID != "" && userID != "" && idempotencyKey != "" && amount > 0
}

type payment struct {
	ID             string     `json:"id"`
	OrderID        string     `json:"orderId"`
	UserID         string     `json:"userId"`
	Amount         float64    `json:"amount"`
	Status         string     `json:"status"` // SUCCEEDED | FAILED | REFUNDED
	Provider       string     `json:"provider"`
	IdempotencyKey string     `json:"idempotencyKey"`
	CreatedAt      time.Time  `json:"createdAt,omitempty"`
	RefundedAt     *time.Time `json:"refundedAt,omitempty"`
}

const paymentCols = `id, order_id, user_id, amount, status, provider, idempotency_key, created_at, refunded_at`

func scanPayment(row interface{ Scan(...interface{}) error }) (payment, error) {
	var p payment
	var refunded sql.NullTime
	err := row.Scan(&p.ID, &p.OrderID, &p.UserID, &p.Amount, &p.Status, &p.Provider, &p.IdempotencyKey, &p.CreatedAt, &refunded)
	if refunded.Valid {
		p.RefundedAt = &refunded.Time
	}
	return p, err
}

// decideRefund is the pure refund decision: "refund" a SUCCEEDED payment,
// "return" an already-REFUNDED one (idempotent), otherwise "not_found".
func decideRefund(found bool, status string) string {
	if !found {
		return "not_found"
	}
	switch status {
	case "SUCCEEDED":
		return "refund"
	case "REFUNDED":
		return "return"
	default:
		return "not_found"
	}
}

// RefundPayment refunds the latest SUCCEEDED payment for an order (idempotent).
func (a *App) RefundPayment(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	orderID := c.Param("orderId")
	p, err := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE order_id=$1 AND status IN ('SUCCEEDED','REFUNDED') ORDER BY created_at DESC LIMIT 1`, orderID))
	found := err == nil
	if err != nil && err != sql.ErrNoRows {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	switch decideRefund(found, p.Status) {
	case "return":
		c.JSON(200, p)
		return
	case "refund":
		// fall through
	default:
		writeError(c, 404, "NOT_FOUND", "succeeded payment not found for order")
		return
	}
	res, err := a.DB.Exec(`UPDATE payments SET status='REFUNDED', refunded_at=NOW() WHERE id=$1 AND status='SUCCEEDED'`, p.ID)
	if err != nil {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	if n, _ := res.RowsAffected(); n == 0 {
		// Concurrent refund won; return current state.
		if again, e2 := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE id=$1`, p.ID)); e2 == nil {
			c.JSON(200, again)
			return
		}
	}
	if saved, e2 := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE id=$1`, p.ID)); e2 == nil {
		p = saved
	} else {
		now := time.Now().UTC()
		p.Status = "REFUNDED"
		p.RefundedAt = &now
	}
	c.JSON(200, p)
}

func (a *App) CreatePayment(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	var body struct {
		OrderID        string  `json:"orderId"`
		UserID         string  `json:"userId"`
		Amount         float64 `json:"amount"`
		PaymentToken   string  `json:"paymentToken"`
		IdempotencyKey string  `json:"idempotencyKey"`
	}
	if err := c.ShouldBindJSON(&body); err != nil || !ValidatePaymentRequest(body.OrderID, body.UserID, body.IdempotencyKey, body.Amount) {
		writeError(c, 400, "VALIDATION_ERROR", "orderId, userId, amount>0 and idempotencyKey are required")
		return
	}
	// Idempotent replay.
	if existing, err := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE idempotency_key=$1`, body.IdempotencyKey)); err == nil {
		c.JSON(200, existing)
		return
	} else if err != sql.ErrNoRows {
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	p := payment{ID: newID(), OrderID: body.OrderID, UserID: body.UserID, Amount: body.Amount, Status: DecideStatus(body.PaymentToken), Provider: "MOCK", IdempotencyKey: body.IdempotencyKey, CreatedAt: time.Now().UTC()}
	_, err := a.DB.Exec(`INSERT INTO payments(id, order_id, user_id, amount, status, provider, idempotency_key) VALUES($1,$2,$3,$4,$5,'MOCK',$6)`, p.ID, p.OrderID, p.UserID, p.Amount, p.Status, p.IdempotencyKey)
	if err != nil {
		// Unique-constraint race: return the existing row.
		if existing, e2 := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE idempotency_key=$1`, body.IdempotencyKey)); e2 == nil {
			c.JSON(200, existing)
			return
		}
		writeError(c, 500, "INTERNAL", err.Error())
		return
	}
	// Re-read created_at from DB if available.
	if saved, err := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE id=$1`, p.ID)); err == nil {
		p = saved
	}
	c.JSON(201, p)
}

func (a *App) GetPaymentDispatch(c *gin.Context) {
	if a.DB == nil {
		writeError(c, 500, "INTERNAL", "database unavailable")
		return
	}
	path := strings.TrimPrefix(c.Param("path"), "/")
	parts := strings.Split(path, "/")
	if len(parts) == 2 && parts[0] == "order" && parts[1] != "" {
		p, err := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE order_id=$1 ORDER BY created_at DESC LIMIT 1`, parts[1]))
		if err == sql.ErrNoRows {
			writeError(c, 404, "NOT_FOUND", "payment not found")
			return
		}
		if err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		c.JSON(200, p)
		return
	}
	if len(parts) == 1 && parts[0] != "" {
		p, err := scanPayment(a.DB.QueryRow(`SELECT `+paymentCols+` FROM payments WHERE id=$1`, parts[0]))
		if err == sql.ErrNoRows {
			writeError(c, 404, "NOT_FOUND", "payment not found")
			return
		}
		if err != nil {
			writeError(c, 500, "INTERNAL", err.Error())
			return
		}
		c.JSON(200, p)
		return
	}
	writeError(c, 404, "NOT_FOUND", "payment not found")
}

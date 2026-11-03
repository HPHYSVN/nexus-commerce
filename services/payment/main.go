package main

import (
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

type App struct {
	DB            *sql.DB
	InternalToken string
}

func writeError(c *gin.Context, status int, code, message string) {
	c.JSON(status, gin.H{"error": gin.H{"code": code, "message": message}})
}

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		return hex.EncodeToString([]byte(time.Now().Format(time.RFC3339Nano)))
	}
	s := hex.EncodeToString(b)
	return s[0:8] + "-" + s[8:12] + "-" + s[12:16] + "-" + s[16:20] + "-" + s[20:32]
}

func getenv(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func openDB(url string) *sql.DB {
	if url == "" {
		log.Println("DATABASE_URL not set; running without DB (handlers will return 500)")
		return nil
	}
	db, err := sql.Open("postgres", url)
	if err != nil {
		log.Printf("sql.Open: %v", err)
		return nil
	}
	db.SetMaxOpenConns(10)
	for i := 0; i < 10; i++ {
		if err := db.Ping(); err == nil {
			break
		} else if i == 9 {
			log.Printf("db ping failed after retries: %v (continuing)", err)
		}
		time.Sleep(time.Second)
	}
	if err := migrate(db); err != nil {
		log.Printf("migrate: %v (continuing)", err)
	}
	return db
}

func migrate(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, order_id TEXT NOT NULL, user_id TEXT NOT NULL, amount NUMERIC NOT NULL, status TEXT NOT NULL, provider TEXT NOT NULL DEFAULT 'MOCK', idempotency_key TEXT UNIQUE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), refunded_at TIMESTAMPTZ)`,
		`ALTER TABLE payments ADD COLUMN IF NOT EXISTS refunded_at TIMESTAMPTZ`,
		`CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

var _ = strings.TrimSpace

func setupRouter(app *App) *gin.Engine {
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok", "service": "payment"}) })
	r.POST("/payments", app.requireInternal, app.CreatePayment)
	r.POST("/payments/order/:orderId/refund", app.requireInternal, app.RefundPayment)
	// Catch-all avoids Gin conflict between /payments/:id and /payments/order/:orderId.
	r.GET("/payments/*path", app.requireInternal, app.GetPaymentDispatch)
	return r
}

func main() {
	port := getenv("PORT", "8084")
	if os.Getenv("RABBITMQ_URL") != "" {
		log.Println("RABBITMQ_URL set (payment service does not publish; order service publishes payment events)")
	}
	app := &App{DB: openDB(os.Getenv("DATABASE_URL")), InternalToken: os.Getenv("INTERNAL_TOKEN")}
	log.Printf("payment listening on %s", port)
	if err := setupRouter(app).Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

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
	DB        *sql.DB
	JWTSecret string
	Inventory *HTTPInventoryClient
	Payment   *HTTPPaymentClient
	Product   *HTTPProductClient
	Events    EventPublisher
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
		`CREATE TABLE IF NOT EXISTS orders (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, status TEXT NOT NULL, total_amount NUMERIC NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`,
		`CREATE TABLE IF NOT EXISTS order_items (id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id) ON DELETE CASCADE, product_id TEXT NOT NULL, product_name_snapshot TEXT NOT NULL DEFAULT '', unit_price_snapshot NUMERIC NOT NULL DEFAULT 0, quantity INT NOT NULL)`,
		`CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
		`CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id, created_at DESC)`,
		`ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key TEXT`,
		`CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_user_idempotency ON orders(user_id, idempotency_key) WHERE idempotency_key IS NOT NULL`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) requireAuth(c *gin.Context) {
	h := c.GetHeader("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		writeError(c, 401, "UNAUTHORIZED", "missing bearer token")
		c.Abort()
		return
	}
	claims, err := VerifyJWT(strings.TrimPrefix(h, "Bearer "), a.JWTSecret)
	if err != nil {
		writeError(c, 401, "UNAUTHORIZED", err.Error())
		c.Abort()
		return
	}
	if claims.Sub == "" {
		writeError(c, 401, "UNAUTHORIZED", "token missing sub")
		c.Abort()
		return
	}
	c.Set("claims", claims)
	c.Set("userId", claims.Sub)
	c.Set("role", claims.Role)
	c.Next()
}

func setupRouter(app *App) *gin.Engine {
	r := gin.Default()
	r.GET("/health", func(c *gin.Context) { c.JSON(200, gin.H{"status": "ok", "service": "order"}) })
	g := r.Group("/orders", app.requireAuth)
	g.POST("", app.CreateOrder)
	g.GET("", app.ListOrders)
	g.GET("/:id", app.GetOrder)
	g.POST("/:id/cancel", app.CancelOrder)
	// Admin routes use a separate top-level group to avoid Gin param
	// conflicts with /orders/:id. requireAdmin runs after requireAuth
	// and before any handler, so non-admins get 403 even without a DB.
	admin := r.Group("/admin", app.requireAuth, app.requireAdmin)
	admin.GET("/orders", app.AdminListOrders)
	admin.GET("/stats", app.AdminStats)
	admin.PUT("/orders/:id/status", app.AdminUpdateOrderStatus)
	return r
}

func main() {
	port := getenv("PORT", "8083")
	app := &App{
		DB:        openDB(os.Getenv("DATABASE_URL")),
		JWTSecret: os.Getenv("JWT_SECRET"),
		Inventory: NewInventoryClient(os.Getenv("INVENTORY_URL"), os.Getenv("INTERNAL_TOKEN")),
		Product:   NewProductClient(os.Getenv("PRODUCT_URL")),
		Payment:   NewPaymentClient(os.Getenv("PAYMENT_URL"), os.Getenv("INTERNAL_TOKEN")),
		Events:    NewRabbitPublisher(os.Getenv("RABBITMQ_URL")),
	}
	log.Printf("order listening on %s", port)
	if err := setupRouter(app).Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

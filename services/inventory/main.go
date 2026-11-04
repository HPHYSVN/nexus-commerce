package main

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	_ "github.com/lib/pq"
)

type App struct {
	DB            *sql.DB
	JWTSecret     string
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
	// UUID-like formatting
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
		`CREATE TABLE IF NOT EXISTS stock_items (product_id TEXT PRIMARY KEY, quantity INT NOT NULL DEFAULT 0, reserved INT NOT NULL DEFAULT 0)`,
		`CREATE TABLE IF NOT EXISTS reservations (id TEXT PRIMARY KEY, product_id TEXT NOT NULL, order_id TEXT NOT NULL, quantity INT NOT NULL, status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), UNIQUE(order_id, product_id))`,
		`CREATE INDEX IF NOT EXISTS idx_reservations_order ON reservations(order_id)`,
		`CREATE TABLE IF NOT EXISTS restock_events (order_id TEXT NOT NULL, product_id TEXT NOT NULL, quantity INT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY(order_id, product_id))`,
	}
	for _, s := range stmts {
		if _, err := db.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

func (a *App) requireAdmin(c *gin.Context) {
	h := c.GetHeader("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		writeError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing bearer token")
		c.Abort()
		return
	}
	claims, err := VerifyJWT(strings.TrimPrefix(h, "Bearer "), a.JWTSecret)
	if err != nil {
		writeError(c, http.StatusUnauthorized, "UNAUTHORIZED", err.Error())
		c.Abort()
		return
	}
	if claims.Role != "ADMIN" {
		writeError(c, http.StatusForbidden, "FORBIDDEN", "admin role required")
		c.Abort()
		return
	}
	c.Set("claims", claims)
	c.Set("userId", claims.Sub)
	c.Next()
}

func (a *App) health(c *gin.Context) {
	if a.DB == nil {
		c.JSON(503, gin.H{"status": "error", "service": "inventory"})
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
	defer cancel()
	if err := a.DB.PingContext(ctx); err != nil {
		c.JSON(503, gin.H{"status": "error", "service": "inventory"})
		return
	}
	c.JSON(200, gin.H{"status": "ok", "service": "inventory"})
}

func setupRouter(app *App) *gin.Engine {
	r := gin.Default()
	r.GET("/health", app.health)
	r.GET("/stock", app.GetStockBatch)
	r.GET("/stock/:productId", app.GetStock)
	r.PUT("/stock/:productId", app.requireAdmin, app.PutStock)
	r.POST("/internal/reservations", app.requireInternal, app.CreateReservation)
	r.POST("/internal/reservations/:orderId/release", app.requireInternal, app.ReleaseReservations)
	r.POST("/internal/reservations/:orderId/confirm", app.requireInternal, app.ConfirmReservations)
	r.POST("/internal/restock", app.requireInternal, app.Restock)
	return r
}

func main() {
	port := getenv("PORT", "8082")
	app := &App{DB: openDB(os.Getenv("DATABASE_URL")), JWTSecret: os.Getenv("JWT_SECRET"), InternalToken: os.Getenv("INTERNAL_TOKEN")}
	log.Printf("inventory listening on %s", port)
	if err := setupRouter(app).Run(":" + port); err != nil {
		log.Fatal(err)
	}
}

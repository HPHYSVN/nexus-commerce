package main

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestCalculateTotal(t *testing.T) {
	items := []OrderItemInput{
		{ProductID: "p1", ProductName: "A", UnitPrice: 10.50, Quantity: 2},
		{ProductID: "p2", ProductName: "B", UnitPrice: 3.33, Quantity: 3},
	}
	if got := CalculateTotal(items); math.Abs(got-30.99) > 0.001 {
		t.Fatalf("total=%v want 30.99", got)
	}
	if CalculateTotal(nil) != 0 {
		t.Fatal("empty total should be 0")
	}
	// Rounding
	if got := CalculateTotal([]OrderItemInput{{ProductID: "p", UnitPrice: 0.1, Quantity: 3}}); math.Abs(got-0.30) > 0.001 {
		t.Fatalf("rounding got %v", got)
	}
}

func TestValidateCreateOrder(t *testing.T) {
	if err := ValidateCreateOrder([]OrderItemInput{{ProductID: "p1", UnitPrice: 0, Quantity: 1}}); err != nil {
		t.Fatalf("valid: %v", err)
	}
	bad := [][]OrderItemInput{
		{},
		{{ProductID: "", Quantity: 1}},
		{{ProductID: "p", Quantity: 0}},
		{{ProductID: "p", Quantity: -1}},
		{{ProductID: "p", Quantity: 1, UnitPrice: -1}},
	}
	for i, b := range bad {
		if err := ValidateCreateOrder(b); err == nil {
			t.Fatalf("case %d should fail", i)
		}
	}
}

func TestStatusTransitions(t *testing.T) {
	if !CanCancel("PENDING") || !CanCancel("CONFIRMED") {
		t.Fatal("PENDING/CONFIRMED should be cancellable")
	}
	for _, s := range []string{"CANCELLED", "PAYMENT_FAILED", ""} {
		if CanCancel(s) {
			t.Fatalf("%s should not be cancellable", s)
		}
	}
	if !ValidTransition("PENDING", "CONFIRMED") || !ValidTransition("PENDING", "PAYMENT_FAILED") || !ValidTransition("CONFIRMED", "CANCELLED") {
		t.Fatal("valid transitions rejected")
	}
	if ValidTransition("CANCELLED", "CONFIRMED") || ValidTransition("PAYMENT_FAILED", "CONFIRMED") {
		t.Fatal("invalid transitions accepted")
	}
}

func TestVerifyJWT(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long!!"
	tok := SignJWT(Claims{Sub: "user-42", Role: "USER", Exp: time.Now().Add(time.Hour).Unix()}, secret)
	claims, err := VerifyJWT(tok, secret)
	if err != nil || claims.Sub != "user-42" || claims.Role != "USER" {
		t.Fatalf("verify: %v %+v", err, claims)
	}
	admin := SignJWT(Claims{Sub: "a1", Role: "ADMIN", Exp: time.Now().Add(time.Hour).Unix()}, secret)
	if c, _ := VerifyJWT(admin, secret); c.Role != "ADMIN" {
		t.Fatal("admin role mismatch")
	}
	if _, err := VerifyJWT(tok, "bad"); err == nil {
		t.Fatal("bad secret should fail")
	}
}

func TestVerifyJWTNoExpAndExpired(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long!!"
	if _, err := VerifyJWT(SignJWT(Claims{Sub: "u", Role: "USER"}, secret), secret); err == nil {
		t.Fatal("no-exp token should fail")
	}
	expired := SignJWT(Claims{Sub: "u", Role: "USER", Exp: time.Now().Add(-time.Hour).Unix()}, secret)
	if _, err := VerifyJWT(expired, secret); err == nil {
		t.Fatal("expired token should fail")
	}
}

func TestResolveIdempotencyKeyAndValidInternalToken(t *testing.T) {
	if resolveIdempotencyKey("hdr", "body") != "hdr" || resolveIdempotencyKey("", "body") != "body" || resolveIdempotencyKey("", "") != "" {
		t.Fatal("resolveIdempotencyKey mismatch")
	}
	if !validInternalToken("s3cret", "s3cret") || validInternalToken("wrong", "s3cret") || validInternalToken("s3cret", "") {
		t.Fatal("validInternalToken mismatch")
	}
}

func TestValidTransitionTable(t *testing.T) {
	cases := []struct {
		from, to string
		want     bool
	}{
		{"PENDING", "CONFIRMED", true},
		{"PENDING", "CANCELLED", true},
		{"PENDING", "PAYMENT_FAILED", true},
		{"CONFIRMED", "PROCESSING", true},
		{"CONFIRMED", "CANCELLED", true},
		{"PROCESSING", "SHIPPED", true},
		{"PROCESSING", "CANCELLED", true},
		{"SHIPPED", "DELIVERED", true},
		{"SHIPPED", "CANCELLED", false},
		{"SHIPPED", "PROCESSING", false},
		{"DELIVERED", "CANCELLED", false},
		{"DELIVERED", "DELIVERED", false},
		{"DELIVERED", "SHIPPED", false},
		{"PENDING", "SHIPPED", false},
		{"PENDING", "PROCESSING", false},
		{"PENDING", "DELIVERED", false},
		{"CONFIRMED", "SHIPPED", false},
		{"CONFIRMED", "DELIVERED", false},
		{"PROCESSING", "DELIVERED", false},
		{"PROCESSING", "CONFIRMED", false},
		{"CANCELLED", "CONFIRMED", false},
		{"PAYMENT_FAILED", "CONFIRMED", false},
		{"", "CONFIRMED", false},
	}
	for _, tc := range cases {
		if got := ValidTransition(tc.from, tc.to); got != tc.want {
			t.Errorf("ValidTransition(%q,%q)=%v want %v", tc.from, tc.to, got, tc.want)
		}
	}
	// Admin-allowed subset: PENDING transitions exist in ValidTransition
	// but must not be admin-triggerable.
	if adminTransitionAllowed("PENDING", "CANCELLED") || adminTransitionAllowed("PENDING", "CONFIRMED") {
		t.Error("admin must not trigger PENDING transitions")
	}
	if !adminTransitionAllowed("CONFIRMED", "PROCESSING") || !adminTransitionAllowed("PROCESSING", "CANCELLED") {
		t.Error("admin transitions rejected")
	}
}

func TestAdminAuth(t *testing.T) {
	gin.SetMode(gin.TestMode)
	secret := "test-secret-at-least-32-chars-long!!"
	app := &App{JWTSecret: secret} // DB nil: auth must run before DB-nil 500
	r := setupRouter(app)
	mint := func(role string) string {
		return SignJWT(Claims{Sub: "u1", Role: role, Exp: time.Now().Add(time.Hour).Unix()}, secret)
	}
	routes := []struct{ method, path string }{
		{http.MethodGet, "/admin/stats"},
		{http.MethodGet, "/admin/orders"},
		{http.MethodPut, "/admin/orders/o1/status"},
	}
	for _, rt := range routes {
		// No token -> 401
		req := httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{"status":"PROCESSING"}`))
		w := httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusUnauthorized {
			t.Errorf("%s %s no token: got %d want 401", rt.method, rt.path, w.Code)
		}
		// Customer -> 403 (testable without DB: admin check precedes DB check)
		req = httptest.NewRequest(rt.method, rt.path, strings.NewReader(`{"status":"PROCESSING"}`))
		req.Header.Set("Authorization", "Bearer "+mint("USER"))
		w = httptest.NewRecorder()
		r.ServeHTTP(w, req)
		if w.Code != http.StatusForbidden {
			t.Errorf("%s %s customer: got %d want 403", rt.method, rt.path, w.Code)
		}
	}
	// Admin passes auth, then hits DB-nil 500 (proves admin check passed).
	req := httptest.NewRequest(http.MethodGet, "/admin/stats", nil)
	req.Header.Set("Authorization", "Bearer "+mint("ADMIN"))
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	if w.Code != http.StatusInternalServerError {
		t.Errorf("admin /admin/stats with nil DB: got %d want 500", w.Code)
	}
}

// Clients must send X-Internal-Token on inventory/payment calls (not product lookup).
func TestClientsSendInternalToken(t *testing.T) {
	var seen []string
	var refundPath string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen = append(seen, r.Method+" "+r.URL.Path+" token="+r.Header.Get("X-Internal-Token"))
		if r.URL.Path == "/payments/order/o1/refund" {
			refundPath = r.URL.Path
			var body map[string]interface{}
			_ = json.NewDecoder(r.Body).Decode(&body)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"id":"pay1","status":"REFUNDED","orderId":"o1"}`))
	}))
	defer srv.Close()
	inv := NewInventoryClient(srv.URL, "tok123")
	pay := NewPaymentClient(srv.URL, "tok123")
	if err := inv.Reserve("o1", "p1", 1); err != nil {
		t.Fatal(err)
	}
	if err := inv.Release("o1"); err != nil {
		t.Fatal(err)
	}
	if err := inv.Confirm("o1"); err != nil {
		t.Fatal(err)
	}
	if err := inv.Restock("o1", "p1", 2); err != nil {
		t.Fatal(err)
	}
	if _, err := pay.Pay("o1", "u1", 10, "tok_ok", "k1"); err != nil {
		t.Fatal(err)
	}
	res, err := pay.Refund("o1")
	if err != nil || res == nil || res.Status != "REFUNDED" {
		t.Fatalf("refund: %v %+v", err, res)
	}
	if refundPath != "/payments/order/o1/refund" {
		t.Fatalf("refund path %q", refundPath)
	}
	if len(seen) != 6 {
		t.Fatalf("seen %v", seen)
	}
	for _, s := range seen {
		if want := " token=tok123"; len(s) < len(want) || s[len(s)-len(want):] != want {
			t.Fatalf("missing internal token: %q", s)
		}
	}
}

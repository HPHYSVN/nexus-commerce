package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestDecideStatus(t *testing.T) {
	if DecideStatus("tok_fail") != "FAILED" {
		t.Fatal("tok_fail should fail")
	}
	for _, tok := range []string{"tok_ok", "", "tok_success", "anything"} {
		if DecideStatus(tok) != "SUCCEEDED" {
			t.Fatalf("token %q should succeed", tok)
		}
	}
}

func TestValidatePaymentRequest(t *testing.T) {
	if !ValidatePaymentRequest("o1", "u1", "k1", 10) {
		t.Fatal("valid should pass")
	}
	cases := []struct {
		o, u, k string
		amt     float64
	}{
		{"", "u1", "k1", 10}, {"o1", "", "k1", 10}, {"o1", "u1", "", 10}, {"o1", "u1", "k1", 0}, {"o1", "u1", "k1", -5},
	}
	for i, tc := range cases {
		if ValidatePaymentRequest(tc.o, tc.u, tc.k, tc.amt) {
			t.Fatalf("case %d should fail", i)
		}
	}
}

func TestVerifyJWT(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long!!"
	tok := SignJWT(Claims{Sub: "user-1", Role: "USER", Exp: time.Now().Add(time.Hour).Unix()}, secret)
	claims, err := VerifyJWT(tok, secret)
	if err != nil || claims.Sub != "user-1" {
		t.Fatalf("verify failed: %v %+v", err, claims)
	}
	if _, err := VerifyJWT(tok+"x", secret); err == nil {
		t.Fatal("tampered token should fail")
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

func TestValidInternalTokenAndMiddleware(t *testing.T) {
	if !validInternalToken("s3cret", "s3cret") {
		t.Fatal("correct token should pass")
	}
	for _, tc := range [][2]string{{"", "s3cret"}, {"wrong", "s3cret"}, {"s3cret", ""}, {"", ""}} {
		if validInternalToken(tc[0], tc[1]) {
			t.Fatalf("validInternalToken(%q,%q) should fail", tc[0], tc[1])
		}
	}
	gin.SetMode(gin.TestMode)
	app := &App{InternalToken: "s3cret"}
	r := gin.New()
	r.POST("/payments", app.requireInternal, func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	for _, tc := range []struct {
		token string
		want  int
	}{{"s3cret", 200}, {"", 401}, {"wrong", 401}} {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/payments", nil)
		if tc.token != "" {
			req.Header.Set("X-Internal-Token", tc.token)
		}
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Fatalf("token %q: got %d want %d", tc.token, w.Code, tc.want)
		}
	}
}

func TestDecideRefund(t *testing.T) {
	cases := []struct {
		found  bool
		status string
		want   string
	}{
		{false, "", "not_found"}, {false, "SUCCEEDED", "not_found"},
		{true, "SUCCEEDED", "refund"}, {true, "REFUNDED", "return"},
		{true, "FAILED", "not_found"}, {true, "", "not_found"},
	}
	for _, tc := range cases {
		if got := decideRefund(tc.found, tc.status); got != tc.want {
			t.Fatalf("decideRefund(%v,%q)=%q want %q", tc.found, tc.status, got, tc.want)
		}
	}
}

func TestSetupRouterInternalAuthAndRefundRoute(t *testing.T) {
	r := setupRouter(&App{InternalToken: "s3cret"}) // DB nil: auth must run before 500; also proves refund route registers without panic
	cases := []struct{ method, path string }{
		{http.MethodPost, "/payments"},
		{http.MethodPost, "/payments/order/o1/refund"},
		{http.MethodGet, "/payments/pay1"},
		{http.MethodGet, "/payments/order/o1"},
	}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(tc.method, tc.path, nil))
		if w.Code != 401 {
			t.Fatalf("%s %s without token: got %d want 401 body=%s", tc.method, tc.path, w.Code, w.Body.String())
		}
		w = httptest.NewRecorder()
		req := httptest.NewRequest(tc.method, tc.path, nil)
		req.Header.Set("X-Internal-Token", "s3cret")
		r.ServeHTTP(w, req)
		if w.Code == 401 {
			t.Fatalf("%s %s with token should not be 401", tc.method, tc.path)
		}
	}
}

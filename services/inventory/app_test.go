package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
)

func TestCanReserve(t *testing.T) {
	cases := []struct {
		q, r, req int
		want      bool
	}{
		{10, 0, 10, true}, {10, 0, 11, false}, {10, 9, 1, true}, {10, 10, 1, false}, {5, 0, 0, false}, {5, 0, -1, false},
	}
	for _, tc := range cases {
		if got := CanReserve(tc.q, tc.r, tc.req); got != tc.want {
			t.Errorf("CanReserve(%d,%d,%d)=%v want %v", tc.q, tc.r, tc.req, got, tc.want)
		}
		if got := Available(tc.q, tc.r); got != tc.q-tc.r {
			t.Errorf("Available mismatch")
		}
	}
}

func TestValidateReservation(t *testing.T) {
	if !validateReservation("o1", "p1", 1) {
		t.Fatal("valid should pass")
	}
	if validateReservation("", "p1", 1) || validateReservation("o1", "", 1) || validateReservation("o1", "p1", 0) {
		t.Fatal("invalid should fail")
	}
}

func TestVerifyJWT(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long!!"
	tok := SignJWT(Claims{Sub: "admin-1", Role: "ADMIN", Exp: time.Now().Add(time.Hour).Unix()}, secret)
	claims, err := VerifyJWT(tok, secret)
	if err != nil {
		t.Fatalf("verify: %v", err)
	}
	if claims.Sub != "admin-1" || claims.Role != "ADMIN" {
		t.Fatalf("claims %+v", claims)
	}
	if _, err := VerifyJWT(tok, "wrong-secret"); err == nil {
		t.Fatal("wrong secret should fail")
	}
	expired := SignJWT(Claims{Sub: "u", Role: "USER", Exp: time.Now().Add(-time.Hour).Unix()}, secret)
	if _, err := VerifyJWT(expired, secret); err == nil {
		t.Fatal("expired should fail")
	}
}

func TestVerifyJWTNoExp(t *testing.T) {
	secret := "test-secret-at-least-32-chars-long!!"
	tok := SignJWT(Claims{Sub: "u", Role: "USER"}, secret) // Exp==0
	if _, err := VerifyJWT(tok, secret); err == nil {
		t.Fatal("no-exp token should fail")
	}
}

func TestValidInternalToken(t *testing.T) {
	if !validInternalToken("s3cret", "s3cret") {
		t.Fatal("correct token should pass")
	}
	for _, tc := range [][2]string{{"", "s3cret"}, {"wrong", "s3cret"}, {"s3cret", ""}, {"", ""}, {"s3cret-longer", "s3cret"}} {
		if validInternalToken(tc[0], tc[1]) {
			t.Fatalf("validInternalToken(%q,%q) should fail (fail-closed)", tc[0], tc[1])
		}
	}
}

func TestRequireInternalMiddleware(t *testing.T) {
	gin.SetMode(gin.TestMode)
	app := &App{InternalToken: "s3cret"}
	r := gin.New()
	r.POST("/internal/restock", app.requireInternal, func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	cases := []struct {
		token string
		want  int
	}{{"s3cret", 200}, {"", 401}, {"wrong", 401}}
	for _, tc := range cases {
		w := httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, "/internal/restock", nil)
		if tc.token != "" {
			req.Header.Set("X-Internal-Token", tc.token)
		}
		r.ServeHTTP(w, req)
		if w.Code != tc.want {
			t.Fatalf("token %q: got %d want %d body=%s", tc.token, w.Code, tc.want, w.Body.String())
		}
	}
	// Fail-closed when env/token unset.
	app2 := &App{}
	r2 := gin.New()
	r2.POST("/internal/restock", app2.requireInternal, func(c *gin.Context) { c.JSON(200, gin.H{"ok": true}) })
	w := httptest.NewRecorder()
	req := httptest.NewRequest(http.MethodPost, "/internal/restock", nil)
	req.Header.Set("X-Internal-Token", "anything")
	r2.ServeHTTP(w, req)
	if w.Code != 401 {
		t.Fatalf("unset token should fail-closed, got %d", w.Code)
	}
}

func TestValidateRestockAndShouldRestock(t *testing.T) {
	if !validateRestock("o1", "p1", 1) || validateRestock("", "p1", 1) || validateRestock("o1", "", 1) || validateRestock("o1", "p1", 0) {
		t.Fatal("validateRestock mismatch")
	}
	if !shouldRestock(1) || shouldRestock(0) {
		t.Fatal("shouldRestock mismatch")
	}
}

func TestSetupRouterInternalAuth(t *testing.T) {
	r := setupRouter(&App{InternalToken: "s3cret"}) // DB nil: auth must run before 500
	for _, path := range []string{"/internal/reservations", "/internal/reservations/o1/release", "/internal/reservations/o1/confirm", "/internal/restock"} {
		w := httptest.NewRecorder()
		r.ServeHTTP(w, httptest.NewRequest(http.MethodPost, path, nil))
		if w.Code != 401 {
			t.Fatalf("%s without token: got %d want 401 body=%s", path, w.Code, w.Body.String())
		}
		w = httptest.NewRecorder()
		req := httptest.NewRequest(http.MethodPost, path, nil)
		req.Header.Set("X-Internal-Token", "s3cret")
		r.ServeHTTP(w, req)
		if w.Code == 401 {
			t.Fatalf("%s with token should not be 401", path)
		}
	}
}

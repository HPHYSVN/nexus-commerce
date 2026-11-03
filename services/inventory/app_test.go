package main

import (
	"testing"
	"time"
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

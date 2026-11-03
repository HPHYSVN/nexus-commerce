package main

import (
	"math"
	"testing"
	"time"
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

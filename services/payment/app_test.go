package main

import (
	"testing"
	"time"
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

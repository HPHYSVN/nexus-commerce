package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"strings"
	"time"
)

// Claims is the JWT payload used by this service.
type Claims struct {
	Sub  string `json:"sub"`
	Role string `json:"role"`
	Exp  int64  `json:"exp"`
	Iat  int64  `json:"iat,omitempty"`
}

// VerifyJWT verifies an HS256 JWT manually (no JWT library) and returns claims.
func VerifyJWT(token string, secret string) (*Claims, error) {
	if secret == "" {
		return nil, errors.New("jwt secret not configured")
	}
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return nil, errors.New("invalid token format")
	}
	var header struct {
		Alg string `json:"alg"`
	}
	hb, err := b64Decode(parts[0])
	if err != nil {
		return nil, errors.New("invalid token header")
	}
	if err := json.Unmarshal(hb, &header); err != nil || header.Alg != "HS256" {
		return nil, errors.New("invalid token alg")
	}
	sig, err := b64Decode(parts[2])
	if err != nil {
		return nil, errors.New("invalid token signature")
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(parts[0] + "." + parts[1]))
	if !hmac.Equal(sig, mac.Sum(nil)) {
		return nil, errors.New("invalid token signature")
	}
	pb, err := b64Decode(parts[1])
	if err != nil {
		return nil, errors.New("invalid token payload")
	}
	var c Claims
	if err := json.Unmarshal(pb, &c); err != nil {
		return nil, errors.New("invalid token payload")
	}
	if c.Sub == "" {
		// Accept userId / user_id fallbacks from other issuers.
		var raw map[string]interface{}
		if err := json.Unmarshal(pb, &raw); err == nil {
			for _, k := range []string{"userId", "user_id", "id"} {
				if v, ok := raw[k].(string); ok && v != "" {
					c.Sub = v
					break
				}
			}
		}
	}
	if c.Exp != 0 && time.Now().Unix() > c.Exp {
		return nil, errors.New("token expired")
	}
	return &c, nil
}

func b64Decode(s string) ([]byte, error) {
	if b, err := base64.RawURLEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.URLEncoding.DecodeString(s)
}

// SignJWT creates an HS256 token (used by tests and local tooling).
func SignJWT(claims Claims, secret string) string {
	header, _ := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	payload, _ := json.Marshal(claims)
	enc := base64.RawURLEncoding.EncodeToString
	signing := enc(header) + "." + enc(payload)
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(signing))
	return signing + "." + enc(mac.Sum(nil))
}

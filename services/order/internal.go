package main

import (
	"crypto/subtle"
	"net/http"
)

const internalTokenHeader = "X-Internal-Token"

// validInternalToken reports whether got matches the configured token.
// Fail-closed: an empty configured token never validates.
func validInternalToken(got, want string) bool {
	if want == "" || got == "" {
		return false
	}
	if len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

// setInternalToken attaches the service-to-service token to an outbound request.
func setInternalToken(req *http.Request, token string) {
	if token != "" {
		req.Header.Set(internalTokenHeader, token)
	}
}

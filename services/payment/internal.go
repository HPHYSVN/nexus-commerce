package main

import (
	"crypto/subtle"
	"net/http"

	"github.com/gin-gonic/gin"
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

// requireInternal rejects requests without a valid X-Internal-Token (401).
func (a *App) requireInternal(c *gin.Context) {
	if !validInternalToken(c.GetHeader(internalTokenHeader), a.InternalToken) {
		writeError(c, http.StatusUnauthorized, "UNAUTHORIZED", "missing or invalid internal token")
		c.Abort()
		return
	}
	c.Next()
}

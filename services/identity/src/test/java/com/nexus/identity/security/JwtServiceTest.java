package com.nexus.identity.security;

import static org.junit.jupiter.api.Assertions.*;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.JwtException;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class JwtServiceTest {

    private final JwtService jwtService =
            new JwtService("test-secret-at-least-32-chars-long-for-hs256!!", 15);

    @Test
    void generateAndParseRoundTrip() {
        UUID userId = UUID.randomUUID();
        String token = jwtService.generateAccessToken(userId, "user@example.com", "CUSTOMER");

        Claims claims = jwtService.parse(token);

        assertEquals(userId.toString(), claims.getSubject());
        assertEquals("user@example.com", claims.get("email", String.class));
        assertEquals("CUSTOMER", claims.get("role", String.class));
        assertNotNull(claims.getIssuedAt());
        assertNotNull(claims.getExpiration());
        assertTrue(claims.getExpiration().after(claims.getIssuedAt()));
    }

    @Test
    void parseRejectsTokenSignedWithDifferentSecret() {
        JwtService other = new JwtService("another-secret-at-least-32-chars-long-value!", 15);
        String token = other.generateAccessToken(UUID.randomUUID(), "a@b.com", "ADMIN");
        assertThrows(JwtException.class, () -> jwtService.parse(token));
    }
}

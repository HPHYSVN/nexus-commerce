package com.nexus.identity.util;

import static org.junit.jupiter.api.Assertions.*;

import org.junit.jupiter.api.Test;

class TokenHashUtilTest {
    @Test
    void sha256HexIsDeterministicAnd64Chars() {
        String hash = TokenHashUtil.sha256Hex("refresh-token-value");
        assertEquals(64, hash.length());
        assertEquals(hash, TokenHashUtil.sha256Hex("refresh-token-value"));
        assertNotEquals(hash, TokenHashUtil.sha256Hex("other"));
        // SHA-256("abc") known vector, via a second input check
        assertEquals(
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
                TokenHashUtil.sha256Hex("abc"));
    }
}

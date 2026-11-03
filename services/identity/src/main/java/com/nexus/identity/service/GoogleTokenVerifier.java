package com.nexus.identity.service;

public interface GoogleTokenVerifier {
    GoogleIdentity verify(String idToken);
}

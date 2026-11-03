package com.nexus.identity.service;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.google.api.client.googleapis.auth.oauth2.GoogleIdTokenVerifier;
import com.google.api.client.http.javanet.NetHttpTransport;
import com.google.api.client.json.jackson2.JacksonFactory;
import com.nexus.identity.exception.ApiException;
import java.util.Collections;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;

@Service
public class GoogleTokenVerifierImpl implements GoogleTokenVerifier {

    private final String clientId;

    public GoogleTokenVerifierImpl(@Value("${app.google.client-id:}") String clientId) {
        this.clientId = clientId;
    }

    @Override
    public GoogleIdentity verify(String idToken) {
        if (clientId == null || clientId.isBlank()) {
            throw new ApiException(HttpStatus.NOT_IMPLEMENTED, "GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured");
        }
        try {
            GoogleIdTokenVerifier verifier = new GoogleIdTokenVerifier.Builder(
                            new NetHttpTransport(), JacksonFactory.getDefaultInstance())
                    .setAudience(Collections.singletonList(clientId))
                    .build();
            GoogleIdToken token = verifier.verify(idToken);
            if (token == null) {
                throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
            }
            GoogleIdToken.Payload payload = token.getPayload();
            Object name = payload.get("name");
            return new GoogleIdentity(
                    payload.getSubject(),
                    payload.getEmail(),
                    Boolean.TRUE.equals(payload.getEmailVerified()),
                    name == null ? null : name.toString());
        } catch (ApiException e) {
            throw e;
        } catch (Exception e) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
        }
    }
}

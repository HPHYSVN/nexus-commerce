package com.nexus.identity.service;

import com.nexus.identity.dto.AuthResponse;
import com.nexus.identity.dto.UserResponse;
import com.nexus.identity.entity.RefreshToken;
import com.nexus.identity.entity.Role;
import com.nexus.identity.entity.User;
import com.nexus.identity.exception.ApiException;
import com.nexus.identity.repository.RefreshTokenRepository;
import com.nexus.identity.repository.UserRepository;
import com.nexus.identity.security.JwtService;
import com.nexus.identity.util.TokenHashUtil;
import java.security.SecureRandom;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.Locale;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AuthService {

    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository users;
    private final RefreshTokenRepository refreshTokens;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final long refreshTtlDays;

    public AuthService(
            UserRepository users,
            RefreshTokenRepository refreshTokens,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            @Value("${app.jwt.refresh-ttl-days:7}") long refreshTtlDays) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.refreshTtlDays = refreshTtlDays;
    }

    @Transactional
    public UserResponse register(String email, String password, String fullName) {
        String normalized = normalize(email);
        if (users.existsByEmail(normalized)) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_ALREADY_EXISTS", "Email already registered");
        }
        User user = new User(normalized, passwordEncoder.encode(password), fullName.trim(), Role.CUSTOMER);
        return UserResponse.from(users.save(user));
    }

    @Transactional
    public AuthResponse login(String email, String password) {
        User user = users.findByEmail(normalize(email))
                .filter(u -> passwordEncoder.matches(password, u.getPasswordHash()))
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "Invalid email or password"));
        return issuePair(user);
    }

    @Transactional
    public AuthResponse refresh(String rawRefreshToken) {
        RefreshToken stored = refreshTokens.findByTokenHash(TokenHashUtil.sha256Hex(rawRefreshToken))
                .orElseThrow(() -> unauthorized());
        Instant now = Instant.now();
        if (stored.isRevoked() || stored.isExpired(now)) {
            throw unauthorized();
        }
        stored.setRevokedAt(now);
        refreshTokens.save(stored);
        return issuePair(stored.getUser());
    }

    @Transactional
    public void logout(String rawRefreshToken) {
        refreshTokens.findByTokenHash(TokenHashUtil.sha256Hex(rawRefreshToken))
                .ifPresent(token -> {
                    if (!token.isRevoked()) {
                        token.setRevokedAt(Instant.now());
                        refreshTokens.save(token);
                    }
                });
    }

    @Transactional(readOnly = true)
    public UserResponse me(UUID userId) {
        User user = users.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized"));
        return UserResponse.from(user);
    }

    private AuthResponse issuePair(User user) {
        String access = jwtService.generateAccessToken(user.getId(), user.getEmail(), user.getRole().name());
        byte[] bytes = new byte[64];
        RANDOM.nextBytes(bytes);
        String rawRefresh = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        Instant expiresAt = Instant.now().plus(refreshTtlDays, ChronoUnit.DAYS);
        refreshTokens.save(new RefreshToken(user, TokenHashUtil.sha256Hex(rawRefresh), expiresAt));
        return new AuthResponse(access, rawRefresh, UserResponse.from(user));
    }

    private static ApiException unauthorized() {
        return new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "Refresh token is invalid, revoked or expired");
    }

    private static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}

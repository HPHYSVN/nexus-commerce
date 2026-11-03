package com.nexus.identity.service;

import com.nexus.identity.dto.AuthResponse;
import com.nexus.identity.dto.UserResponse;
import com.nexus.identity.entity.EmailToken;
import com.nexus.identity.entity.EmailTokenType;
import com.nexus.identity.entity.RefreshToken;
import com.nexus.identity.entity.Role;
import com.nexus.identity.entity.User;
import com.nexus.identity.exception.ApiException;
import com.nexus.identity.repository.EmailTokenRepository;
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
import org.springframework.beans.factory.annotation.Autowired;
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
    private final EmailTokenRepository emailTokens;
    private final PasswordEncoder passwordEncoder;
    private final JwtService jwtService;
    private final MailService mailService;
    private final GoogleTokenVerifier googleTokenVerifier;
    private final long refreshTtlDays;
    private final String googleClientId;
    private final String appBaseUrl;

    @Autowired
    public AuthService(
            UserRepository users,
            RefreshTokenRepository refreshTokens,
            EmailTokenRepository emailTokens,
            PasswordEncoder passwordEncoder,
            JwtService jwtService,
            MailService mailService,
            GoogleTokenVerifier googleTokenVerifier,
            @Value("${app.jwt.refresh-ttl-days:7}") long refreshTtlDays,
            @Value("${app.google.client-id:}") String googleClientId,
            @Value("${app.base-url:http://localhost:5173}") String appBaseUrl) {
        this.users = users;
        this.refreshTokens = refreshTokens;
        this.emailTokens = emailTokens;
        this.passwordEncoder = passwordEncoder;
        this.jwtService = jwtService;
        this.mailService = mailService;
        this.googleTokenVerifier = googleTokenVerifier;
        this.refreshTtlDays = refreshTtlDays;
        this.googleClientId = googleClientId;
        this.appBaseUrl = appBaseUrl;
    }

    @Transactional
    public UserResponse register(String email, String password, String fullName) {
        String normalized = normalize(email);
        if (users.existsByEmail(normalized)) {
            throw new ApiException(HttpStatus.CONFLICT, "EMAIL_ALREADY_EXISTS", "Email already registered");
        }
        User user = new User(normalized, passwordEncoder.encode(password), fullName.trim(), Role.CUSTOMER);
        user.setProvider("LOCAL");
        user.setEmailVerified(false);
        User saved = users.save(user);
        String raw = createEmailToken(saved, EmailTokenType.VERIFY, 24, ChronoUnit.HOURS);
        mailService.sendVerificationEmail(saved.getEmail(), link("/verify-email?token=" + raw));
        return UserResponse.from(saved);
    }

    @Transactional
    public AuthResponse login(String email, String password) {
        User user = users.findByEmail(normalize(email))
                .filter(u -> u.getPasswordHash() != null && passwordEncoder.matches(password, u.getPasswordHash()))
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
        return UserResponse.from(requireUser(userId));
    }

    @Transactional
    public void verifyEmail(String rawToken) {
        EmailToken token = validEmailToken(rawToken, EmailTokenType.VERIFY);
        User user = token.getUser();
        user.setEmailVerified(true);
        users.save(user);
        token.setUsedAt(Instant.now());
        emailTokens.save(token);
    }

    @Transactional
    public void resendVerification(UUID userId) {
        User user = requireUser(userId);
        if (user.isEmailVerified()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "ALREADY_VERIFIED", "Email is already verified");
        }
        String raw = createEmailToken(user, EmailTokenType.VERIFY, 24, ChronoUnit.HOURS);
        mailService.sendVerificationEmail(user.getEmail(), link("/verify-email?token=" + raw));
    }

    @Transactional
    public void forgotPassword(String email) {
        users.findByEmail(normalize(email))
                .filter(u -> u.getPasswordHash() != null)
                .ifPresent(user -> {
                    String raw = createEmailToken(user, EmailTokenType.RESET, 1, ChronoUnit.HOURS);
                    mailService.sendPasswordResetEmail(user.getEmail(), link("/reset-password?token=" + raw));
                });
    }

    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        EmailToken token = validEmailToken(rawToken, EmailTokenType.RESET);
        User user = token.getUser();
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        users.save(user);
        token.setUsedAt(Instant.now());
        emailTokens.save(token);
        refreshTokens.revokeAllByUser(user, Instant.now());
    }

    @Transactional
    public AuthResponse googleLogin(String idToken) {
        if (googleClientId == null || googleClientId.isBlank()) {
            throw new ApiException(HttpStatus.NOT_IMPLEMENTED, "GOOGLE_NOT_CONFIGURED", "Google sign-in is not configured");
        }
        GoogleIdentity identity = googleTokenVerifier.verify(idToken);
        if (identity == null || identity.subject() == null || identity.email() == null || identity.email().isBlank()) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "INVALID_GOOGLE_TOKEN", "Invalid Google token");
        }
        String normalized = normalize(identity.email());
        User user = users.findByGoogleSubject(identity.subject()).orElse(null);
        if (user == null) {
            user = users.findByEmail(normalized).orElse(null);
            if (user != null) {
                user.setGoogleSubject(identity.subject());
                // Keep existing provider (e.g. LOCAL) for linked password accounts.
                if (identity.emailVerified()) {
                    user.setEmailVerified(true);
                }
                user = users.save(user);
            }
        } else if (identity.emailVerified() && !user.isEmailVerified()) {
            user.setEmailVerified(true);
            user = users.save(user);
        }
        if (user == null) {
            String name = identity.name() != null && !identity.name().isBlank()
                    ? identity.name().trim()
                    : normalized.substring(0, normalized.indexOf('@'));
            user = new User(normalized, null, name, Role.CUSTOMER);
            user.setProvider("GOOGLE");
            user.setGoogleSubject(identity.subject());
            user.setEmailVerified(identity.emailVerified());
            user = users.save(user);
        }
        return issuePair(user);
    }

    @Transactional
    public UserResponse updateProfile(UUID userId, String fullName) {
        User user = requireUser(userId);
        user.setFullName(fullName.trim());
        return UserResponse.from(users.save(user));
    }

    @Transactional
    public void changePassword(UUID userId, String currentPassword, String newPassword) {
        User user = requireUser(userId);
        if (user.getPasswordHash() == null) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "NO_PASSWORD_SET", "No password is set for this account");
        }
        if (!passwordEncoder.matches(currentPassword, user.getPasswordHash())) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_CURRENT_PASSWORD", "Current password is incorrect");
        }
        user.setPasswordHash(passwordEncoder.encode(newPassword));
        users.save(user);
        refreshTokens.revokeAllByUser(user, Instant.now());
    }

    private EmailToken validEmailToken(String rawToken, EmailTokenType type) {
        EmailToken token = emailTokens.findByTokenHash(TokenHashUtil.sha256Hex(rawToken))
                .orElseThrow(() -> invalidToken());
        Instant now = Instant.now();
        if (token.getType() != type || token.isUsed() || token.isExpired(now)) {
            throw invalidToken();
        }
        return token;
    }

    private String createEmailToken(User user, EmailTokenType type, long amount, ChronoUnit unit) {
        byte[] bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        String raw = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
        emailTokens.save(new EmailToken(user, TokenHashUtil.sha256Hex(raw), type, Instant.now().plus(amount, unit)));
        return raw;
    }

    private String link(String path) {
        String base = appBaseUrl == null ? "" : appBaseUrl.replaceAll("/+$", "");
        return base + path;
    }

    private User requireUser(UUID userId) {
        return users.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized"));
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

    private static ApiException invalidToken() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_TOKEN", "Token is invalid, expired or already used");
    }

    private static String normalize(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }
}

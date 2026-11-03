package com.nexus.identity.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.nexus.identity.dto.AuthResponse;
import com.nexus.identity.entity.EmailToken;
import com.nexus.identity.entity.EmailTokenType;
import com.nexus.identity.entity.Role;
import com.nexus.identity.entity.User;
import com.nexus.identity.exception.ApiException;
import com.nexus.identity.repository.EmailTokenRepository;
import com.nexus.identity.repository.RefreshTokenRepository;
import com.nexus.identity.repository.UserRepository;
import com.nexus.identity.security.JwtService;
import com.nexus.identity.util.TokenHashUtil;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.crypto.password.PasswordEncoder;

class AuthServiceTest {

    private UserRepository users;
    private RefreshTokenRepository refreshTokens;
    private EmailTokenRepository emailTokens;
    private PasswordEncoder encoder;
    private JwtService jwt;
    private MailService mail;
    private AuthService service;
    private GoogleTokenVerifier fakeVerifier;

    @BeforeEach
    void setUp() {
        users = mock(UserRepository.class);
        refreshTokens = mock(RefreshTokenRepository.class);
        emailTokens = mock(EmailTokenRepository.class);
        encoder = mock(PasswordEncoder.class);
        jwt = mock(JwtService.class);
        mail = mock(MailService.class);
        fakeVerifier = idToken -> new GoogleIdentity("sub-123", "New@Example.com", true, "New User");
        service = new AuthService(users, refreshTokens, emailTokens, encoder, jwt, mail, fakeVerifier, 7, "test-client-id", "http://localhost:5173");
        when(jwt.generateAccessToken(any(), anyString(), anyString())).thenReturn("access-token");
        when(users.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void googleLoginCreatesNewUserAndIssuesPair() {
        when(users.findByGoogleSubject("sub-123")).thenReturn(Optional.empty());
        when(users.findByEmail("new@example.com")).thenReturn(Optional.empty());

        AuthResponse res = service.googleLogin("fake-id-token");

        assertEquals("access-token", res.accessToken());
        assertNotNull(res.refreshToken());
        assertEquals("GOOGLE", res.user().provider());
        assertTrue(res.user().emailVerified());
        assertEquals("new@example.com", res.user().email());
        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(users).save(captor.capture());
        assertNull(captor.getValue().getPasswordHash());
        assertEquals("sub-123", captor.getValue().getGoogleSubject());
        verify(refreshTokens).save(any());
    }

    @Test
    void googleLoginLinksExistingEmailUser() {
        User existing = new User("new@example.com", "hash", "Existing", Role.CUSTOMER);
        when(users.findByGoogleSubject("sub-123")).thenReturn(Optional.empty());
        when(users.findByEmail("new@example.com")).thenReturn(Optional.of(existing));

        AuthResponse res = service.googleLogin("fake-id-token");

        assertEquals("sub-123", existing.getGoogleSubject());
        assertTrue(existing.isEmailVerified());
        assertEquals("LOCAL", res.user().provider());
        assertEquals("access-token", res.accessToken());
    }

    @Test
    void googleLoginFindsBySubject() {
        User existing = new User("new@example.com", null, "G User", Role.CUSTOMER);
        existing.setProvider("GOOGLE");
        existing.setGoogleSubject("sub-123");
        when(users.findByGoogleSubject("sub-123")).thenReturn(Optional.of(existing));

        AuthResponse res = service.googleLogin("fake-id-token");
        assertEquals("GOOGLE", res.user().provider());
        verify(users, never()).findByEmail(anyString());
    }

    @Test
    void verifyEmailMarksVerifiedAndConsumesToken() {
        User user = new User("a@b.com", "hash", "A", Role.CUSTOMER);
        String raw = "raw-verify-token";
        EmailToken token = new EmailToken(user, TokenHashUtil.sha256Hex(raw), EmailTokenType.VERIFY, Instant.now().plus(1, ChronoUnit.HOURS));
        when(emailTokens.findByTokenHash(TokenHashUtil.sha256Hex(raw))).thenReturn(Optional.of(token));

        service.verifyEmail(raw);

        assertTrue(user.isEmailVerified());
        assertNotNull(token.getUsedAt());
        verify(users).save(user);
        verify(emailTokens).save(token);
    }

    @Test
    void verifyEmailRejectsExpiredToken() {
        User user = new User("a@b.com", "hash", "A", Role.CUSTOMER);
        String raw = "expired";
        EmailToken token = new EmailToken(user, TokenHashUtil.sha256Hex(raw), EmailTokenType.VERIFY, Instant.now().minus(1, ChronoUnit.HOURS));
        when(emailTokens.findByTokenHash(anyString())).thenReturn(Optional.of(token));

        ApiException ex = assertThrows(ApiException.class, () -> service.verifyEmail(raw));
        assertEquals(400, ex.getStatus().value());
        assertFalse(user.isEmailVerified());
    }

    @Test
    void resetPasswordSetsHashConsumesAndRevokesAll() {
        User user = new User("a@b.com", "old", "A", Role.CUSTOMER);
        String raw = "raw-reset-token";
        EmailToken token = new EmailToken(user, TokenHashUtil.sha256Hex(raw), EmailTokenType.RESET, Instant.now().plus(1, ChronoUnit.HOURS));
        when(emailTokens.findByTokenHash(TokenHashUtil.sha256Hex(raw))).thenReturn(Optional.of(token));
        when(encoder.encode("newPassword1")).thenReturn("newHash");

        service.resetPassword(raw, "newPassword1");

        assertEquals("newHash", user.getPasswordHash());
        assertNotNull(token.getUsedAt());
        verify(refreshTokens).revokeAllByUser(eq(user), any(Instant.class));
    }

    @Test
    void resetRejectsVerifyTokenType() {
        User user = new User("a@b.com", "old", "A", Role.CUSTOMER);
        String raw = "tok";
        EmailToken token = new EmailToken(user, TokenHashUtil.sha256Hex(raw), EmailTokenType.VERIFY, Instant.now().plus(1, ChronoUnit.HOURS));
        when(emailTokens.findByTokenHash(anyString())).thenReturn(Optional.of(token));
        assertThrows(ApiException.class, () -> service.resetPassword(raw, "newPassword1"));
    }

    @Test
    void loginOAuthOnlyUserGivesGeneric401() {
        User user = new User("g@b.com", null, "G", Role.CUSTOMER);
        user.setProvider("GOOGLE");
        when(users.findByEmail("g@b.com")).thenReturn(Optional.of(user));
        ApiException ex = assertThrows(ApiException.class, () -> service.login("g@b.com", "whatever123"));
        assertEquals("INVALID_CREDENTIALS", ex.getCode());
        assertEquals(401, ex.getStatus().value());
    }

    @Test
    void registerCreatesVerifyTokenAndMailsLink() {
        when(users.existsByEmail("a@b.com")).thenReturn(false);
        when(encoder.encode("password123")).thenReturn("hash");
        var res = service.register("A@B.com", "password123", " A ");
        assertFalse(res.emailVerified());
        assertEquals("LOCAL", res.provider());
        ArgumentCaptor<EmailToken> captor = ArgumentCaptor.forClass(EmailToken.class);
        verify(emailTokens).save(captor.capture());
        assertEquals(EmailTokenType.VERIFY, captor.getValue().getType());
        assertEquals(64, captor.getValue().getTokenHash().length());
        verify(mail).sendVerificationEmail(eq("a@b.com"), argThat(link -> link.startsWith("http://localhost:5173/verify-email?token=")));
    }

    @Test
    void forgotPasswordUnknownEmailDoesNothingButSucceeds() {
        when(users.findByEmail("no@b.com")).thenReturn(Optional.empty());
        assertDoesNotThrow(() -> service.forgotPassword("no@b.com"));
        verifyNoInteractions(mail);
        verify(emailTokens, never()).save(any());
    }
}

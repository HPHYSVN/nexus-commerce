package com.nexus.identity.controller;

import com.nexus.identity.dto.*;
import com.nexus.identity.exception.ApiException;
import com.nexus.identity.service.AuthService;
import jakarta.validation.Valid;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth")
public class AuthController {

    private final AuthService authService;

    public AuthController(AuthService authService) {
        this.authService = authService;
    }

    @PostMapping("/register")
    public ResponseEntity<UserResponse> register(@Valid @RequestBody RegisterRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(authService.register(request.email(), request.password(), request.fullName()));
    }

    @PostMapping("/login")
    public AuthResponse login(@Valid @RequestBody LoginRequest request) {
        return authService.login(request.email(), request.password());
    }

    @PostMapping("/refresh")
    public AuthResponse refresh(@Valid @RequestBody RefreshRequest request) {
        return authService.refresh(request.refreshToken());
    }

    @PostMapping("/logout")
    public ResponseEntity<Void> logout(@Valid @RequestBody LogoutRequest request) {
        authService.logout(request.refreshToken());
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/me")
    public UserResponse me(Authentication authentication) {
        return authService.me(principalId(authentication));
    }

    @PutMapping("/me")
    public UserResponse updateProfile(@Valid @RequestBody UpdateProfileRequest request, Authentication authentication) {
        return authService.updateProfile(principalId(authentication), request.fullName());
    }

    @PostMapping("/verify-email")
    public MessageResponse verifyEmail(@Valid @RequestBody VerifyEmailRequest request) {
        authService.verifyEmail(request.token());
        return new MessageResponse("Email verified");
    }

    @PostMapping("/resend-verification")
    public MessageResponse resendVerification(Authentication authentication) {
        authService.resendVerification(principalId(authentication));
        return new MessageResponse("Verification email sent");
    }

    @PostMapping("/forgot-password")
    public MessageResponse forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        authService.forgotPassword(request.email());
        return new MessageResponse("If an account exists for this email, a password reset link has been sent");
    }

    @PostMapping("/reset-password")
    public MessageResponse resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        authService.resetPassword(request.token(), request.newPassword());
        return new MessageResponse("Password has been reset");
    }

    @PostMapping("/google")
    public AuthResponse google(@Valid @RequestBody GoogleLoginRequest request) {
        return authService.googleLogin(request.idToken());
    }

    @PostMapping("/change-password")
    public MessageResponse changePassword(@Valid @RequestBody ChangePasswordRequest request, Authentication authentication) {
        authService.changePassword(principalId(authentication), request.currentPassword(), request.newPassword());
        return new MessageResponse("Password changed");
    }

    private static UUID principalId(Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized");
        }
        return UUID.fromString(authentication.getName());
    }
}

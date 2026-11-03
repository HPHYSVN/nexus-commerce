package com.nexus.identity.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record ResetPasswordRequest(
        @NotBlank String token,
        @NotBlank @Size(min = 8, max = 100, message = "password must be 8-100 characters") String newPassword) {}

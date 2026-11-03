package com.nexus.identity.dto;

import jakarta.validation.constraints.NotBlank;

public record GoogleLoginRequest(@NotBlank String idToken) {}

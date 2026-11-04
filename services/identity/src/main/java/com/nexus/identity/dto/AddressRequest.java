package com.nexus.identity.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

public record AddressRequest(
        @Size(max = 100, message = "label must be at most 100 characters")
        String label,

        @NotBlank(message = "recipientName is required")
        @Size(max = 100)
        String recipientName,

        @NotBlank(message = "phone is required")
        @Size(max = 30)
        String phone,

        @NotBlank(message = "addressLine is required")
        @Size(max = 255)
        String addressLine,

        @NotBlank(message = "city is required")
        @Size(max = 100)
        String city,

        Boolean isDefault
) {}

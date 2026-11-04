package com.nexus.identity.dto;

import com.nexus.identity.entity.UserAddress;
import java.util.UUID;

public record AddressResponse(
        UUID id,
        String label,
        String recipientName,
        String phone,
        String addressLine,
        String city,
        boolean isDefault
) {
    public static AddressResponse from(UserAddress address) {
        return new AddressResponse(
                address.getId(),
                address.getLabel(),
                address.getRecipientName(),
                address.getPhone(),
                address.getAddressLine(),
                address.getCity(),
                address.isDefault());
    }
}

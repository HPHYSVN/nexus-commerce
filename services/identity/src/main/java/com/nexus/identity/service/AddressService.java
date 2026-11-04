package com.nexus.identity.service;

import com.nexus.identity.dto.AddressRequest;
import com.nexus.identity.dto.AddressResponse;
import com.nexus.identity.entity.User;
import com.nexus.identity.entity.UserAddress;
import com.nexus.identity.exception.ApiException;
import com.nexus.identity.repository.UserAddressRepository;
import com.nexus.identity.repository.UserRepository;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class AddressService {

    private final UserAddressRepository addresses;
    private final UserRepository users;

    public AddressService(UserAddressRepository addresses, UserRepository users) {
        this.addresses = addresses;
        this.users = users;
    }

    @Transactional(readOnly = true)
    public List<AddressResponse> list(UUID userId) {
        User user = requireUser(userId);
        return addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user).stream()
                .map(AddressResponse::from)
                .toList();
    }

    @Transactional
    public AddressResponse create(UUID userId, AddressRequest request) {
        User user = requireUser(userId);
        List<UserAddress> existing = addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user);
        boolean makeDefault = Boolean.TRUE.equals(request.isDefault()) || existing.isEmpty();
        if (makeDefault) {
            unsetDefaults(existing, null);
        }
        UserAddress address = new UserAddress(
                user,
                trimToNull(request.label()),
                request.recipientName().trim(),
                request.phone().trim(),
                request.addressLine().trim(),
                request.city().trim(),
                makeDefault);
        return AddressResponse.from(addresses.save(address));
    }

    @Transactional
    public AddressResponse update(UUID userId, UUID addressId, AddressRequest request) {
        User user = requireUser(userId);
        UserAddress address = addresses.findByIdAndUser(addressId, user)
                .orElseThrow(() -> notFound());
        boolean makeDefault = request.isDefault() == null ? address.isDefault() : request.isDefault();
        if (makeDefault && !address.isDefault()) {
            unsetDefaults(addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user), address);
        }
        address.setLabel(trimToNull(request.label()));
        address.setRecipientName(request.recipientName().trim());
        address.setPhone(request.phone().trim());
        address.setAddressLine(request.addressLine().trim());
        address.setCity(request.city().trim());
        address.setDefault(makeDefault);
        return AddressResponse.from(addresses.save(address));
    }

    @Transactional
    public void delete(UUID userId, UUID addressId) {
        User user = requireUser(userId);
        UserAddress address = addresses.findByIdAndUser(addressId, user)
                .orElseThrow(() -> notFound());
        addresses.delete(address);
    }

    private void unsetDefaults(List<UserAddress> existing, UserAddress except) {
        for (UserAddress other : existing) {
            if (other != except && other.isDefault()) {
                other.setDefault(false);
                addresses.save(other);
            }
        }
    }

    private User requireUser(UUID userId) {
        return users.findById(userId)
                .orElseThrow(() -> new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized"));
    }

    private static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "ADDRESS_NOT_FOUND", "Address not found");
    }

    private static String trimToNull(String value) {
        if (value == null) return null;
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}

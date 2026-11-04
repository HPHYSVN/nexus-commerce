package com.nexus.identity.service;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.nexus.identity.dto.AddressRequest;
import com.nexus.identity.dto.AddressResponse;
import com.nexus.identity.entity.Role;
import com.nexus.identity.entity.User;
import com.nexus.identity.entity.UserAddress;
import com.nexus.identity.exception.ApiException;
import com.nexus.identity.repository.UserAddressRepository;
import com.nexus.identity.repository.UserRepository;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

class AddressServiceTest {

    private UserAddressRepository addresses;
    private UserRepository users;
    private AddressService service;
    private User user;
    private UUID userId;

    @BeforeEach
    void setUp() {
        addresses = mock(UserAddressRepository.class);
        users = mock(UserRepository.class);
        service = new AddressService(addresses, users);
        user = new User("a@b.com", "hash", "A", Role.CUSTOMER);
        userId = UUID.randomUUID();
        when(users.findById(userId)).thenReturn(Optional.of(user));
        when(addresses.save(any(UserAddress.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    private AddressRequest req(Boolean isDefault) {
        return new AddressRequest("Home", "Alice", "0901234567", "1 Main St", "Hanoi", isDefault);
    }

    @Test
    void listReturnsOwnAddressesInRepositoryOrder() {
        UserAddress a1 = new UserAddress(user, "Home", "Alice", "0901", "1 Main", "Hanoi", true);
        UserAddress a2 = new UserAddress(user, "Work", "Alice", "0901", "2 Main", "Hanoi", false);
        when(addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user)).thenReturn(List.of(a1, a2));

        List<AddressResponse> res = service.list(userId);

        assertEquals(2, res.size());
        assertEquals("Home", res.get(0).label());
        assertTrue(res.get(0).isDefault());
        assertEquals("Work", res.get(1).label());
        assertFalse(res.get(1).isDefault());
        verify(addresses).findByUserOrderByIsDefaultDescCreatedAtAsc(user);
    }

    @Test
    void createFirstAddressAutoDefaultsEvenWhenNotRequested() {
        when(addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user)).thenReturn(List.of());

        AddressResponse res = service.create(userId, req(null));

        assertTrue(res.isDefault());
        assertEquals("Alice", res.recipientName());
        assertEquals("Hanoi", res.city());
        verify(addresses).save(any(UserAddress.class));
    }

    @Test
    void createFirstAddressAutoDefaultsEvenWhenFalse() {
        when(addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user)).thenReturn(List.of());

        assertTrue(service.create(userId, req(false)).isDefault());
    }

    @Test
    void createWithDefaultUnsetsPreviousDefault() {
        UserAddress previous = new UserAddress(user, "Home", "Alice", "0901", "1 Main", "Hanoi", true);
        when(addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user)).thenReturn(List.of(previous));

        AddressResponse res = service.create(userId, req(true));

        assertTrue(res.isDefault());
        assertFalse(previous.isDefault());
        verify(addresses).save(previous);
    }

    @Test
    void createNonDefaultDoesNotUnsetPrevious() {
        UserAddress previous = new UserAddress(user, "Home", "Alice", "0901", "1 Main", "Hanoi", true);
        when(addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user)).thenReturn(List.of(previous));

        AddressResponse res = service.create(userId, req(false));

        assertFalse(res.isDefault());
        assertTrue(previous.isDefault());
    }

    @Test
    void updateOwnAddressChangesFields() {
        UUID id = UUID.randomUUID();
        UserAddress existing = new UserAddress(user, "Home", "Alice", "0901", "1 Main", "Hanoi", true);
        when(addresses.findByIdAndUser(id, user)).thenReturn(Optional.of(existing));

        AddressResponse res = service.update(userId, id,
                new AddressRequest("Office", "Bob", "0912", "9 Side St", "Hue", null));

        assertEquals("Office", res.label());
        assertEquals("Bob", res.recipientName());
        assertEquals("Hue", res.city());
        assertTrue(res.isDefault());
    }

    @Test
    void updateWithDefaultUnsetsPreviousDefault() {
        UUID id = UUID.randomUUID();
        UserAddress target = new UserAddress(user, "Work", "Alice", "0901", "2 Main", "Hanoi", false);
        UserAddress previous = new UserAddress(user, "Home", "Alice", "0901", "1 Main", "Hanoi", true);
        when(addresses.findByIdAndUser(id, user)).thenReturn(Optional.of(target));
        when(addresses.findByUserOrderByIsDefaultDescCreatedAtAsc(user)).thenReturn(List.of(previous, target));

        AddressResponse res = service.update(userId, id, req(true));

        assertTrue(res.isDefault());
        assertFalse(previous.isDefault());
        verify(addresses).save(previous);
    }

    @Test
    void updateCrossUserOrMissingReturns404() {
        UUID id = UUID.randomUUID();
        when(addresses.findByIdAndUser(id, user)).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class, () -> service.update(userId, id, req(true)));
        assertEquals(404, ex.getStatus().value());
        assertEquals("ADDRESS_NOT_FOUND", ex.getCode());
        verify(addresses, never()).save(any());
    }

    @Test
    void deleteOwnAddress() {
        UUID id = UUID.randomUUID();
        UserAddress existing = new UserAddress(user, "Home", "Alice", "0901", "1 Main", "Hanoi", true);
        when(addresses.findByIdAndUser(id, user)).thenReturn(Optional.of(existing));

        service.delete(userId, id);

        verify(addresses).delete(existing);
    }

    @Test
    void deleteCrossUserOrMissingReturns404() {
        UUID id = UUID.randomUUID();
        when(addresses.findByIdAndUser(id, user)).thenReturn(Optional.empty());

        ApiException ex = assertThrows(ApiException.class, () -> service.delete(userId, id));
        assertEquals(404, ex.getStatus().value());
        verify(addresses, never()).delete(any());
    }

    @Test
    void unknownUserIsUnauthorized() {
        UUID unknown = UUID.randomUUID();
        when(users.findById(unknown)).thenReturn(Optional.empty());
        ApiException ex = assertThrows(ApiException.class, () -> service.list(unknown));
        assertEquals(401, ex.getStatus().value());
    }

    @Test
    void validationRejectsBlankRequiredFields() {
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
        var violations = validator.validate(new AddressRequest(null, " ", "", null, "  ", null));
        Set<String> fields = violations.stream()
                .map(v -> v.getPropertyPath().toString())
                .collect(Collectors.toSet());
        assertTrue(fields.containsAll(Set.of("recipientName", "phone", "addressLine", "city")));
    }

    @Test
    void validationAcceptsValidRequestWithOptionalLabelAndDefault() {
        Validator validator = Validation.buildDefaultValidatorFactory().getValidator();
        assertTrue(validator.validate(req(null)).isEmpty());
        assertTrue(validator.validate(new AddressRequest(null, "Alice", "0901", "1 Main", "Hanoi", null)).isEmpty());
    }
}

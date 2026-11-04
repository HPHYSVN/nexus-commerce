package com.nexus.identity.controller;

import com.nexus.identity.dto.AddressRequest;
import com.nexus.identity.dto.AddressResponse;
import com.nexus.identity.exception.ApiException;
import com.nexus.identity.service.AddressService;
import jakarta.validation.Valid;
import java.util.List;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/auth/addresses")
public class AddressController {

    private final AddressService addressService;

    public AddressController(AddressService addressService) {
        this.addressService = addressService;
    }

    @GetMapping
    public List<AddressResponse> list(Authentication authentication) {
        return addressService.list(principalId(authentication));
    }

    @PostMapping
    public ResponseEntity<AddressResponse> create(@Valid @RequestBody AddressRequest request, Authentication authentication) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(addressService.create(principalId(authentication), request));
    }

    @PutMapping("/{id}")
    public AddressResponse update(@PathVariable UUID id, @Valid @RequestBody AddressRequest request, Authentication authentication) {
        return addressService.update(principalId(authentication), id, request);
    }

    @DeleteMapping("/{id}")
    public ResponseEntity<Void> delete(@PathVariable UUID id, Authentication authentication) {
        addressService.delete(principalId(authentication), id);
        return ResponseEntity.noContent().build();
    }

    private static UUID principalId(Authentication authentication) {
        if (authentication == null || authentication.getName() == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "Unauthorized");
        }
        return UUID.fromString(authentication.getName());
    }
}

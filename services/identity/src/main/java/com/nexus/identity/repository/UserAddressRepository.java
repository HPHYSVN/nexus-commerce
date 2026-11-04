package com.nexus.identity.repository;

import com.nexus.identity.entity.User;
import com.nexus.identity.entity.UserAddress;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserAddressRepository extends JpaRepository<UserAddress, UUID> {
    List<UserAddress> findByUserOrderByIsDefaultDescCreatedAtAsc(User user);
    Optional<UserAddress> findByIdAndUser(UUID id, User user);
}

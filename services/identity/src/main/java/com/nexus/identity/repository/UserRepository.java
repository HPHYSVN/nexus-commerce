package com.nexus.identity.repository;

import com.nexus.identity.entity.User;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface UserRepository extends JpaRepository<User, UUID> {
    Optional<User> findByEmail(String email);
    Optional<User> findByGoogleSubject(String googleSubject);
    boolean existsByEmail(String email);
}

package com.nexus.identity.repository;

import com.nexus.identity.entity.EmailToken;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EmailTokenRepository extends JpaRepository<EmailToken, UUID> {
    Optional<EmailToken> findByTokenHash(String tokenHash);
}

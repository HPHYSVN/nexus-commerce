package com.nexus.identity.repository;

import com.nexus.identity.entity.RefreshToken;
import com.nexus.identity.entity.User;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface RefreshTokenRepository extends JpaRepository<RefreshToken, UUID> {
    Optional<RefreshToken> findByTokenHash(String tokenHash);

    @Modifying
    @Query("update RefreshToken t set t.revokedAt = :now where t.user = :user and t.revokedAt is null")
    int revokeAllByUser(@Param("user") User user, @Param("now") Instant now);
}

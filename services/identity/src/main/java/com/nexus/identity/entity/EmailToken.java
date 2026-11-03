package com.nexus.identity.entity;

import jakarta.persistence.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "email_tokens")
public class EmailToken {

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private UUID id;

    @ManyToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "user_id", nullable = false)
    private User user;

    @Column(nullable = false, unique = true, length = 64)
    private String tokenHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private EmailTokenType type;

    @Column(nullable = false)
    private Instant expiresAt;

    private Instant usedAt;

    @Column(nullable = false, updatable = false)
    private Instant createdAt;

    @PrePersist
    void onCreate() {
        if (createdAt == null) createdAt = Instant.now();
    }

    public EmailToken() {}

    public EmailToken(User user, String tokenHash, EmailTokenType type, Instant expiresAt) {
        this.user = user;
        this.tokenHash = tokenHash;
        this.type = type;
        this.expiresAt = expiresAt;
    }

    public boolean isUsed() { return usedAt != null; }
    public boolean isExpired(Instant now) { return !expiresAt.isAfter(now); }

    public UUID getId() { return id; }
    public User getUser() { return user; }
    public void setUser(User user) { this.user = user; }
    public String getTokenHash() { return tokenHash; }
    public void setTokenHash(String tokenHash) { this.tokenHash = tokenHash; }
    public EmailTokenType getType() { return type; }
    public void setType(EmailTokenType type) { this.type = type; }
    public Instant getExpiresAt() { return expiresAt; }
    public void setExpiresAt(Instant expiresAt) { this.expiresAt = expiresAt; }
    public Instant getUsedAt() { return usedAt; }
    public void setUsedAt(Instant usedAt) { this.usedAt = usedAt; }
    public Instant getCreatedAt() { return createdAt; }
}

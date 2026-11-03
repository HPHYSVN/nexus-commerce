package com.nexus.identity.service;

public record GoogleIdentity(String subject, String email, boolean emailVerified, String name) {}

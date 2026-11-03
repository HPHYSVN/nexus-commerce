package com.nexus.identity.config;

import com.nexus.identity.entity.Role;
import com.nexus.identity.entity.User;
import com.nexus.identity.repository.UserRepository;
import java.util.Locale;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

@Component
public class AdminSeeder implements CommandLineRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    private final UserRepository users;
    private final PasswordEncoder passwordEncoder;
    private final String email;
    private final String password;
    private final String fullName;

    public AdminSeeder(
            UserRepository users,
            PasswordEncoder passwordEncoder,
            @Value("${app.admin.email:admin@nexus.local}") String email,
            @Value("${app.admin.password:Admin123!}") String password,
            @Value("${app.admin.full-name:Administrator}") String fullName) {
        this.users = users;
        this.passwordEncoder = passwordEncoder;
        this.email = email;
        this.password = password;
        this.fullName = fullName;
    }

    @Override
    @Transactional
    public void run(String... args) {
        String normalized = email.trim().toLowerCase(Locale.ROOT);
        if (!users.existsByEmail(normalized)) {
            users.save(new User(normalized, passwordEncoder.encode(password), fullName, Role.ADMIN));
            log.info("Seeded admin user {}", normalized);
        }
    }
}

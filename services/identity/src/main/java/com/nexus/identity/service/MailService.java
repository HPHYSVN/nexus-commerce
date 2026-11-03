package com.nexus.identity.service;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Service;

@Service
public class MailService {

    private static final Logger log = LoggerFactory.getLogger(MailService.class);

    private final ObjectProvider<JavaMailSender> mailSenderProvider;
    private final String host;
    private final String from;

    public MailService(
            ObjectProvider<JavaMailSender> mailSenderProvider,
            @Value("${app.mail.host:}") String host,
            @Value("${app.mail.from:}") String from) {
        this.mailSenderProvider = mailSenderProvider;
        this.host = host;
        this.from = from;
    }

    public void sendVerificationEmail(String to, String link) {
        send(to, "Verify your email", "Verify your email by opening this link: " + link, link);
    }

    public void sendPasswordResetEmail(String to, String link) {
        send(to, "Reset your password", "Reset your password by opening this link: " + link, link);
    }

    void send(String to, String subject, String body, String link) {
        if (host == null || host.isBlank()) {
            log.info("[DEV-MAIL] to={} subject={} link={}", to, subject, link);
            return;
        }
        JavaMailSender sender = mailSenderProvider.getIfAvailable();
        if (sender == null) {
            log.info("[DEV-MAIL] to={} subject={} link={}", to, subject, link);
            return;
        }
        SimpleMailMessage message = new SimpleMailMessage();
        if (from != null && !from.isBlank()) {
            message.setFrom(from);
        }
        message.setTo(to);
        message.setSubject(subject);
        message.setText(body);
        sender.send(message);
    }
}

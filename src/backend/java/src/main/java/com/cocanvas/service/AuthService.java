package com.cocanvas.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import javax.crypto.SecretKeyFactory;
import javax.crypto.spec.PBEKeySpec;

import com.cocanvas.persistence.entity.UserEntity;
import com.cocanvas.persistence.repository.UserRepository;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class AuthService {

    private static final String DEFAULT_COLOR = "#3772ff";
    private static final String PASSWORD_HASH_PREFIX = "pbkdf2";
    private static final int PASSWORD_ITERATIONS = 120_000;
    private static final int PASSWORD_KEY_LENGTH_BITS = 256;
    private static final SecureRandom PASSWORD_RANDOM = new SecureRandom();

    private final UserRepository userRepository;
    private final String secret;
    private final long ttlMs;

    public AuthService(
            UserRepository userRepository,
            @Value("${auth-token.secret:${AUTH_TOKEN_SECRET:cocanvas-auth-dev-secret}}") String secret,
            @Value("${auth-token.ttl-ms:604800000}") long ttlMs
    ) {
        this.userRepository = userRepository;
        this.secret = secret == null || secret.isBlank() ? "cocanvas-auth-dev-secret" : secret;
        this.ttlMs = Math.max(60_000L, ttlMs);
    }

    public LoginResult login(LoginCommand command) {
        String username = cleanUsername(command.username());
        String password = command.password() == null ? "" : command.password();
        if (username.length() < 3) {
            throw new AuthException("用户名至少需要 3 个字符");
        }
        if (password.length() < 4) {
            throw new AuthException("密码至少需要 4 个字符");
        }

        long now = System.currentTimeMillis();
        UserEntity user = userRepository.findByUsername(username)
                .map(existing -> {
                    if (!matchesPassword(password, existing.getPasswordHash())) {
                        throw new AuthException("用户名或密码不正确");
                    }
                    if (!isPbkdf2Hash(existing.getPasswordHash())) {
                        existing.setPasswordHash(hashPassword(password));
                    }
                    existing.setDisplayName(cleanDisplayName(command.displayName(), existing.getDisplayName()));
                    existing.setColor(cleanColor(command.color(), existing.getColor()));
                    existing.setLastLoginAt(now);
                    return existing;
                })
                .orElseGet(() -> {
                    UserEntity created = new UserEntity();
                    created.setUserId("u-" + UUID.randomUUID());
                    created.setUsername(username);
                    created.setPasswordHash(hashPassword(password));
                    created.setDisplayName(cleanDisplayName(command.displayName(), username));
                    created.setColor(cleanColor(command.color(), DEFAULT_COLOR));
                    created.setCreatedAt(now);
                    created.setLastLoginAt(now);
                    return created;
                });

        UserEntity saved = userRepository.save(user);
        return new LoginResult(
                saved.getUserId(),
                saved.getUsername(),
                saved.getDisplayName(),
                saved.getColor(),
                issue(saved)
        );
    }

    public Optional<UserPrincipal> authenticateHeader(String authorizationHeader) {
        if (authorizationHeader == null || authorizationHeader.isBlank()) {
            return Optional.empty();
        }
        String token = authorizationHeader.trim();
        if (token.regionMatches(true, 0, "Bearer ", 0, 7)) {
            token = token.substring(7).trim();
        }
        return verify(token);
    }

    public Optional<UserPrincipal> verify(String token) {
        if (token == null || token.isBlank()) {
            return Optional.empty();
        }

        try {
            String decoded = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", 4);
            if (parts.length != 4) {
                return Optional.empty();
            }

            String payload = parts[0] + "|" + parts[1] + "|" + parts[2];
            if (!MessageDigest.isEqual(parts[3].getBytes(StandardCharsets.UTF_8), sign(payload).getBytes(StandardCharsets.UTF_8))) {
                return Optional.empty();
            }

            long expiresAt = Long.parseLong(parts[2]);
            if (expiresAt < System.currentTimeMillis()) {
                return Optional.empty();
            }

            return userRepository.findById(parts[0])
                    .map(user -> new UserPrincipal(
                            user.getUserId(),
                            user.getUsername(),
                            user.getDisplayName(),
                            user.getColor()
                    ));
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }

    public Optional<UserEntity> findUser(String userId) {
        return userRepository.findById(userId);
    }

    public Optional<UserEntity> findByUsername(String username) {
        return userRepository.findByUsername(cleanUsername(username));
    }

    private String issue(UserEntity user) {
        long expiresAt = System.currentTimeMillis() + ttlMs;
        String payload = user.getUserId() + "|" + user.getUsername() + "|" + expiresAt;
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString((payload + "|" + sign(payload)).getBytes(StandardCharsets.UTF_8));
    }

    private String sign(String payload) {
        return sha256Hex(payload + "|" + secret);
    }

    private String hashPassword(String password) {
        byte[] salt = new byte[16];
        PASSWORD_RANDOM.nextBytes(salt);
        byte[] hash = pbkdf2(password, salt, PASSWORD_ITERATIONS, PASSWORD_KEY_LENGTH_BITS);
        return PASSWORD_HASH_PREFIX
                + "$" + PASSWORD_ITERATIONS
                + "$" + Base64.getEncoder().encodeToString(salt)
                + "$" + Base64.getEncoder().encodeToString(hash);
    }

    private boolean matchesPassword(String password, String storedHash) {
        if (storedHash == null || storedHash.isBlank()) {
            return false;
        }

        if (!isPbkdf2Hash(storedHash)) {
            return MessageDigest.isEqual(
                    storedHash.getBytes(StandardCharsets.UTF_8),
                    sha256Hex(password).getBytes(StandardCharsets.UTF_8)
            );
        }

        try {
            String[] parts = storedHash.split("\\$", 4);
            if (parts.length != 4) {
                return false;
            }
            int iterations = Integer.parseInt(parts[1]);
            byte[] salt = Base64.getDecoder().decode(parts[2]);
            byte[] expected = Base64.getDecoder().decode(parts[3]);
            byte[] actual = pbkdf2(password, salt, iterations, expected.length * 8);
            return MessageDigest.isEqual(expected, actual);
        } catch (RuntimeException ex) {
            return false;
        }
    }

    private boolean isPbkdf2Hash(String storedHash) {
        return storedHash != null && storedHash.startsWith(PASSWORD_HASH_PREFIX + "$");
    }

    private byte[] pbkdf2(String password, byte[] salt, int iterations, int keyLengthBits) {
        PBEKeySpec spec = new PBEKeySpec(password.toCharArray(), salt, iterations, keyLengthBits);
        try {
            return SecretKeyFactory.getInstance("PBKDF2WithHmacSHA256")
                    .generateSecret(spec)
                    .getEncoded();
        } catch (Exception ex) {
            throw new IllegalStateException("PBKDF2 is not available", ex);
        } finally {
            spec.clearPassword();
        }
    }

    private String sha256Hex(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    private String cleanUsername(String username) {
        if (username == null) {
            return "";
        }
        return username.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.-]", "");
    }

    private String cleanDisplayName(String displayName, String fallback) {
        if (displayName == null || displayName.isBlank()) {
            return fallback == null || fallback.isBlank() ? "Cocanvas user" : fallback;
        }
        return displayName.trim();
    }

    private String cleanColor(String color, String fallback) {
        if (color == null || !color.matches("^#[0-9a-fA-F]{6}$")) {
            return fallback == null || fallback.isBlank() ? DEFAULT_COLOR : fallback;
        }
        return color;
    }

    public record LoginCommand(String username, String password, String displayName, String color) {}

    public record LoginResult(String userId, String username, String displayName, String color, String authToken) {}

    public record UserPrincipal(String userId, String username, String displayName, String color) {}

    public static class AuthException extends RuntimeException {
        public AuthException(String message) {
            super(message);
        }
    }
}

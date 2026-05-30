package com.cocanvas.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Duration;
import java.util.Base64;
import java.util.HexFormat;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

@Service
public class JoinTokenService {

    private final String secret;
    private final long ttlMs;

    public JoinTokenService(
            @Value("${join-token.secret:${JOIN_TOKEN_SECRET:cocanvas-dev-secret}}") String secret,
            @Value("${join-token.ttl-ms:300000}") long ttlMs
    ) {
        this.secret = secret == null || secret.isBlank() ? "cocanvas-dev-secret" : secret;
        this.ttlMs = Math.max(Duration.ofSeconds(30).toMillis(), ttlMs);
    }

    public String issue(String roomId, String permissionMode) {
        long expiresAt = System.currentTimeMillis() + ttlMs;
        String payload = roomId + "|" + cleanPermission(permissionMode) + "|" + expiresAt + "|cluster";
        return Base64.getUrlEncoder().withoutPadding()
                .encodeToString((payload + "|" + sign(payload)).getBytes(StandardCharsets.UTF_8));
    }

    public TokenClaims verify(String roomId, String token) {
        if (token == null || token.isBlank()) {
            return TokenClaims.invalid();
        }

        try {
            String decoded = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
            String[] parts = decoded.split("\\|", 5);
            if (parts.length != 5) {
                return TokenClaims.invalid();
            }

            String payload = parts[0] + "|" + parts[1] + "|" + parts[2] + "|" + parts[3];
            if (!constantTimeEquals(parts[4], sign(payload))) {
                return TokenClaims.invalid();
            }

            long expiresAt = Long.parseLong(parts[2]);
            if (!roomId.equals(parts[0]) || expiresAt < System.currentTimeMillis()) {
                return TokenClaims.invalid();
            }

            return new TokenClaims(true, parts[0], cleanPermission(parts[1]), expiresAt);
        } catch (Exception ignored) {
            return TokenClaims.invalid();
        }
    }

    private String sign(String payload) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest((payload + "|" + secret).getBytes(StandardCharsets.UTF_8)));
        } catch (Exception ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    private boolean constantTimeEquals(String left, String right) {
        return MessageDigest.isEqual(
                left.getBytes(StandardCharsets.UTF_8),
                right.getBytes(StandardCharsets.UTF_8)
        );
    }

    private String cleanPermission(String permissionMode) {
        if (permissionMode == null || permissionMode.isBlank()) {
            return "edit";
        }

        return permissionMode.trim().toLowerCase();
    }

    public record TokenClaims(boolean valid, String roomId, String permissionMode, long expiresAt) {

        public static TokenClaims invalid() {
            return new TokenClaims(false, "", "", 0);
        }
    }
}

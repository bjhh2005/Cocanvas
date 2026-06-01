package com.cocanvas.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.Base64;

import org.junit.jupiter.api.Test;

class JoinTokenServiceTest {

    @Test
    void issuedTokenVerifiesForSameRoomAndPermission() {
        JoinTokenService service = new JoinTokenService("unit-secret", 300_000);

        String token = service.issue("room-a", "comment");
        JoinTokenService.TokenClaims claims = service.verify("room-a", token);

        assertThat(claims.valid()).isTrue();
        assertThat(claims.roomId()).isEqualTo("room-a");
        assertThat(claims.permissionMode()).isEqualTo("comment");
        assertThat(claims.expiresAt()).isGreaterThan(System.currentTimeMillis());
    }

    @Test
    void tokenIsRejectedForWrongRoom() {
        JoinTokenService service = new JoinTokenService("unit-secret", 300_000);

        String token = service.issue("room-a", "edit");

        assertThat(service.verify("room-b", token).valid()).isFalse();
    }

    @Test
    void tokenIsRejectedWhenPayloadIsTampered() {
        JoinTokenService service = new JoinTokenService("unit-secret", 300_000);
        String token = service.issue("room-a", "edit");
        String decoded = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
        String tampered = Base64.getUrlEncoder().withoutPadding()
                .encodeToString(decoded.replace("edit", "view").getBytes(StandardCharsets.UTF_8));

        assertThat(service.verify("room-a", tampered).valid()).isFalse();
    }

    @Test
    void malformedOrBlankTokensAreRejected() {
        JoinTokenService service = new JoinTokenService("unit-secret", 300_000);

        assertThat(service.verify("room-a", "").valid()).isFalse();
        assertThat(service.verify("room-a", "not-base64").valid()).isFalse();
    }
}

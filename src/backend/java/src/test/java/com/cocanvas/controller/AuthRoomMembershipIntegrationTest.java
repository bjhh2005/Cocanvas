package com.cocanvas.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest
@AutoConfigureMockMvc
class AuthRoomMembershipIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Test
    void creatorBecomesOwnerAndCanEnterPasswordRoomByMemberRole() throws Exception {
        Account alice = login("alice-" + suffix());
        String roomId = "members-" + suffix();

        JsonNode created = postJson(post("/api/rooms").with(request -> {
            request.addHeader("Authorization", "Bearer " + alice.token());
            return request;
        }), Map.of(
                "roomId", roomId,
                "name", "Members room",
                "accessMode", "link",
                "permissionMode", "view",
                "password", "secret",
                "voiceEnabled", false
        ));

        assertThat(created.get("roomId").asText()).isEqualTo(roomId);
        assertThat(created.get("memberRole").asText()).isEqualTo("owner");
        assertThat(created.get("joinToken").asText()).isNotBlank();

        JsonNode anonymous = getJson(get("/api/rooms/{roomId}", roomId));
        assertThat(anonymous.get("authorized").asBoolean()).isFalse();

        JsonNode ownerAccess = getJson(get("/api/rooms/{roomId}", roomId)
                .header("Authorization", "Bearer " + alice.token()));
        assertThat(ownerAccess.get("authorized").asBoolean()).isTrue();
        assertThat(ownerAccess.get("memberRole").asText()).isEqualTo("owner");
        assertThat(ownerAccess.get("permissionMode").asText()).isEqualTo("edit");
    }

    @Test
    void ownerCanGrantMemberRoleAndOwnerRoleCannotBeSelfDowngraded() throws Exception {
        Account alice = login("owner-" + suffix());
        Account bob = login("editor-" + suffix());
        Account eve = login("viewer-" + suffix());
        String roomId = "acl-" + suffix();

        postJson(post("/api/rooms").header("Authorization", "Bearer " + alice.token()), Map.of(
                "roomId", roomId,
                "name", "ACL room",
                "accessMode", "link",
                "permissionMode", "view",
                "voiceEnabled", false
        ));

        JsonNode member = putJson(put("/api/rooms/{roomId}/members", roomId)
                .header("Authorization", "Bearer " + alice.token()), Map.of(
                "username", bob.username(),
                "role", "comment"
        ));
        assertThat(member.get("userId").asText()).isEqualTo(bob.userId());
        assertThat(member.get("role").asText()).isEqualTo("comment");

        JsonNode bobAccess = getJson(get("/api/rooms/{roomId}", roomId)
                .header("Authorization", "Bearer " + bob.token()));
        assertThat(bobAccess.get("authorized").asBoolean()).isTrue();
        assertThat(bobAccess.get("memberRole").asText()).isEqualTo("comment");
        assertThat(bobAccess.get("permissionMode").asText()).isEqualTo("comment");

        mockMvc.perform(put("/api/rooms/{roomId}/members", roomId)
                        .header("Authorization", "Bearer " + bob.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "username", eve.username(),
                                "role", "edit"
                        ))))
                .andExpect(status().isForbidden());

        mockMvc.perform(put("/api/rooms/{roomId}/members", roomId)
                        .header("Authorization", "Bearer " + alice.token())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "userId", alice.userId(),
                                "role", "view"
                        ))))
                .andExpect(status().isForbidden());
    }

    private Account login(String username) throws Exception {
        JsonNode response = postJson(post("/api/auth/login"), Map.of(
                "username", username,
                "password", "pass1234",
                "displayName", username,
                "color", "#3772ff"
        ));
        return new Account(
                response.get("userId").asText(),
                response.get("username").asText(),
                response.get("authToken").asText()
        );
    }

    private JsonNode postJson(MockHttpServletRequestBuilder request, Object body) throws Exception {
        return json(request, body);
    }

    private JsonNode putJson(MockHttpServletRequestBuilder request, Object body) throws Exception {
        return json(request, body);
    }

    private JsonNode json(MockHttpServletRequestBuilder request, Object body) throws Exception {
        String payload = mockMvc.perform(request
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(body)))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(payload);
    }

    private JsonNode getJson(MockHttpServletRequestBuilder request) throws Exception {
        String payload = mockMvc.perform(request)
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(payload);
    }

    private String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }

    private record Account(String userId, String username, String token) {
    }
}

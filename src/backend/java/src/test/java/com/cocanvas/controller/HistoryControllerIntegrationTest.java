package com.cocanvas.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.Map;
import java.util.UUID;
import java.util.stream.StreamSupport;

import com.cocanvas.persistence.entity.OperationLogEntity;
import com.cocanvas.persistence.entity.SnapshotEntity;
import com.cocanvas.persistence.repository.OperationLogRepository;
import com.cocanvas.persistence.repository.SnapshotRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
class HistoryControllerIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private SnapshotRepository snapshotRepository;

    @Autowired
    private OperationLogRepository operationLogRepository;

    @Test
    void anchorsExposeRoomCreationSnapshotsAndLatestOperation() throws Exception {
        String roomId = "anchors-" + suffix();
        long createdAt = createRoom(roomId).get("createdAt").asLong();

        saveSnapshot(roomId, 1_000L, "{}");
        saveSnapshot(roomId, 2_000L, "{\"shape-a\":{}}");
        saveOperation(roomId, "op-a-" + suffix(), 2_500L, "{\"opType\":\"create\"}");
        saveOperation(roomId, "op-b-" + suffix(), 3_500L, "{\"opType\":\"update\"}");

        JsonNode response = getJson("/api/rooms/" + roomId + "/history/anchors");

        assertThat(response.get("roomCreatedAt").asLong()).isEqualTo(createdAt);
        assertThat(response.get("latestOpAt").asLong()).isEqualTo(3_500L);
        assertThat(StreamSupport.stream(response.get("snapshots").spliterator(), false)
                .map(JsonNode::asLong)
                .toList()).containsExactly(1_000L, 2_000L);
    }

    @Test
    void historyStartsFromLatestSnapshotBeforeTargetTime() throws Exception {
        String roomId = "history-" + suffix();
        createRoom(roomId);

        saveSnapshot(roomId, 1_000L, "{\"shape-old\":{}}");
        saveSnapshot(roomId, 2_000L, "{\"shape-base\":{}}");
        saveOperation(roomId, "op-before-" + suffix(), 1_900L, "{\"opId\":\"before\"}");
        saveOperation(roomId, "op-at-snapshot-" + suffix(), 2_000L, "{\"opId\":\"at-snapshot\"}");
        saveOperation(roomId, "op-after-" + suffix(), 2_500L, "{\"opId\":\"after\"}");
        saveOperation(roomId, "op-late-" + suffix(), 4_000L, "{\"opId\":\"late\"}");

        JsonNode response = getJson("/api/rooms/" + roomId + "/history?at=3000");

        assertThat(response.get("snapshot").get("createdAt").asLong()).isEqualTo(2_000L);
        assertThat(response.get("snapshot").get("payload").asText()).isEqualTo("{\"shape-base\":{}}");
        assertThat(StreamSupport.stream(response.get("ops").spliterator(), false)
                .map(op -> op.get("payload").asText())
                .toList()).containsExactly("{\"opId\":\"at-snapshot\"}", "{\"opId\":\"after\"}");
    }

    private JsonNode createRoom(String roomId) throws Exception {
        String payload = mockMvc.perform(post("/api/rooms")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(Map.of(
                                "roomId", roomId,
                                "name", "History test",
                                "accessMode", "link",
                                "permissionMode", "edit",
                                "voiceEnabled", false
                        ))))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(payload);
    }

    private JsonNode getJson(String path) throws Exception {
        String payload = mockMvc.perform(get(path))
                .andExpect(status().isOk())
                .andReturn()
                .getResponse()
                .getContentAsString();
        return objectMapper.readTree(payload);
    }

    private void saveSnapshot(String roomId, long createdAt, String payload) {
        SnapshotEntity snapshot = new SnapshotEntity();
        snapshot.setSnapshotId("snapshot-" + suffix());
        snapshot.setRoomId(roomId);
        snapshot.setCreatedAt(createdAt);
        snapshot.setHlc("");
        snapshot.setPayload(payload);
        snapshotRepository.save(snapshot);
    }

    private void saveOperation(String roomId, String opId, long createdAt, String payload) {
        OperationLogEntity operation = new OperationLogEntity();
        operation.setOpId(opId);
        operation.setRoomId(roomId);
        operation.setUserId("user-test");
        operation.setOpType("update");
        operation.setShapeId("shape-test");
        operation.setShapeType("rect");
        operation.setHlc(createdAt + ".0.test");
        operation.setCreatedAt(createdAt);
        operation.setPayload(payload);
        operationLogRepository.save(operation);
    }

    private String suffix() {
        return UUID.randomUUID().toString().substring(0, 8);
    }
}

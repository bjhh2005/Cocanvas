package com.cocanvas.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AiServiceSanitizationEdgeTest {

    private final AiService aiService = new AiService(new ObjectMapper());
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    @SuppressWarnings("unchecked")
    void clampsLargeNumbersAndTrimsLongText() throws Exception {
        String longBody = "x".repeat(1_400);
        String modelJson = objectMapper.writeValueAsString(Map.of(
                "message", "已生成",
                "ops", List.of(Map.of(
                        "opType", "create",
                        "shapeId", "ai-card-raw",
                        "shapeType", "card",
                        "attrs", Map.of(
                                "x", -999_999,
                                "y", 999_999,
                                "w", 99_999,
                                "h", -30,
                                "fontSize", 120,
                                "votes", 2_000,
                                "body", longBody
                        )
                ))
        ));

        AiService.AiChatResponse response = parseModelContent(modelJson);

        assertThat(response.ops()).hasSize(1);
        Map<String, Object> attrs = (Map<String, Object>) response.ops().get(0).get("attrs");
        assertThat(attrs).containsEntry("x", -100000L);
        assertThat(attrs).containsEntry("y", 100000L);
        assertThat(attrs).containsEntry("w", 2000L);
        assertThat(attrs).containsEntry("h", 20L);
        assertThat(attrs).containsEntry("fontSize", 72L);
        assertThat(attrs).containsEntry("votes", 999L);
        assertThat(String.valueOf(attrs.get("body"))).endsWith("...（内容已裁剪）");
    }

    @Test
    @SuppressWarnings("unchecked")
    void connectorReferencesAreRemappedWhenTheyPointAtCreatedShapes() throws Exception {
        String modelJson = objectMapper.writeValueAsString(Map.of(
                "message", "已连接",
                "ops", List.of(
                        Map.of(
                                "opType", "create",
                                "shapeId", "raw-a",
                                "shapeType", "card",
                                "attrs", Map.of("title", "A")
                        ),
                        Map.of(
                                "opType", "create",
                                "shapeId", "raw-b",
                                "shapeType", "card",
                                "attrs", Map.of("title", "B")
                        ),
                        Map.of(
                                "opType", "create",
                                "shapeId", "raw-connector",
                                "shapeType", "connector",
                                "attrs", Map.of(
                                        "fromShapeId", "raw-a",
                                        "toShapeId", "raw-b",
                                        "fromAnchor", "not-real",
                                        "toAnchor", "left"
                                )
                        )
                )
        ));

        AiService.AiChatResponse response = parseModelContent(modelJson);

        assertThat(response.ops()).hasSize(3);
        String firstId = String.valueOf(response.ops().get(0).get("shapeId"));
        String secondId = String.valueOf(response.ops().get(1).get("shapeId"));
        Map<String, Object> connectorAttrs = (Map<String, Object>) response.ops().get(2).get("attrs");
        assertThat(firstId).startsWith("ai-");
        assertThat(secondId).startsWith("ai-");
        assertThat(connectorAttrs).containsEntry("fromShapeId", firstId);
        assertThat(connectorAttrs).containsEntry("toShapeId", secondId);
        assertThat(connectorAttrs).containsEntry("fromAnchor", "center");
        assertThat(connectorAttrs).containsEntry("toAnchor", "left");
    }

    private AiService.AiChatResponse parseModelContent(String modelContent) throws Exception {
        String responseBody = objectMapper.writeValueAsString(Map.of(
                "choices", List.of(Map.of("message", Map.of("content", modelContent)))
        ));
        return ReflectionTestUtils.invokeMethod(aiService, "parseOpenAiResponse", responseBody);
    }
}

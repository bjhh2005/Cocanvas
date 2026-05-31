package com.cocanvas.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

class AiServiceTest {

    private final AiService aiService = new AiService(new ObjectMapper());
    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void returnsHelpfulMessageWhenApiKeyIsMissing() {
        ReflectionTestUtils.setField(aiService, "apiKey", "");

        AiService.AiChatResponse response = aiService.chat("room-a", new AiService.AiChatRequest("生成卡片", "当前为空"));

        assertThat(response.message()).contains("AI 功能未配置");
        assertThat(response.ops()).isEmpty();
    }

    @Test
    @SuppressWarnings("unchecked")
    void parsesAndSanitizesModelOperations() throws Exception {
        String modelJson = objectMapper.writeValueAsString(Map.of(
                "message", "已生成内容",
                "ops", List.of(
                        Map.of(
                                "opType", "create",
                                "shapeId", "unsafe-id",
                                "shapeType", "card",
                                "attrs", Map.of(
                                        "x", 999_999,
                                        "y", 120,
                                        "title", "Valid",
                                        "priority", "invalid-priority",
                                        "tags", List.of("A", "B", "C", "D", "E", "F", "G", "H", "I"),
                                        "points", List.of(0, 0, 999, 999),
                                        "authorId", "attacker",
                                        "fromShapeId", "shape-private",
                                        "groupId", "room-admin"
                                )
                        ),
                        Map.of(
                                "opType", "update",
                                "shapeId", "shape-a",
                                "shapeType", "card",
                                "attrs", Map.of("title", "Should be dropped")
                        ),
                        Map.of(
                                "opType", "create",
                                "shapeId", "image-a",
                                "shapeType", "image",
                                "attrs", Map.of("x", 0, "y", 0)
                        )
                )
        ));

        AiService.AiChatResponse response = parseModelContent("```json\n" + modelJson + "\n```");

        assertThat(response).isNotNull();
        assertThat(response.ops()).hasSize(1);
        Map<String, Object> op = response.ops().get(0);
        assertThat(op).containsEntry("opType", "create");
        assertThat(op).containsEntry("shapeType", "card");
        assertThat(String.valueOf(op.get("shapeId"))).startsWith("ai-");

        Map<String, Object> attrs = (Map<String, Object>) op.get("attrs");
        assertThat(attrs).containsEntry("x", 100000L);
        assertThat(attrs).containsEntry("priority", "medium");
        assertThat((List<String>) attrs.get("tags")).hasSize(8);
        assertThat(attrs).doesNotContainKeys("points", "authorId", "fromShapeId", "groupId");
    }

    @Test
    @SuppressWarnings("unchecked")
    void addsSafeDefaultsWhenAllowedCreateOperationHasMalformedAttrs() throws Exception {
        String modelJson = objectMapper.writeValueAsString(Map.of(
                "message", "已生成便利贴",
                "ops", List.of(Map.of(
                        "opType", "create",
                        "shapeId", "sticky-unsafe",
                        "shapeType", "sticky",
                        "attrs", "unexpected"
                ))
        ));

        AiService.AiChatResponse response = parseModelContent(modelJson);

        assertThat(response).isNotNull();
        assertThat(response.ops()).hasSize(1);

        Map<String, Object> op = response.ops().get(0);
        assertThat(op).containsEntry("opType", "create");
        assertThat(op).containsEntry("shapeType", "sticky");
        assertThat(String.valueOf(op.get("shapeId"))).startsWith("ai-");

        Map<String, Object> attrs = (Map<String, Object>) op.get("attrs");
        assertThat(attrs).containsEntry("x", 220);
        assertThat(attrs).containsEntry("y", 180);
        assertThat(attrs).containsEntry("text", "AI idea");
        assertThat(attrs).containsEntry("fill", "#ffd966");
    }

    @Test
    void returnsSafeFallbackWhenModelContentIsMalformed() throws Exception {
        AiService.AiChatResponse response = parseModelContent("not json at all");

        assertThat(response).isNotNull();
        assertThat(response.message()).contains("格式不稳定");
        assertThat(response.ops()).isEmpty();
    }

    private AiService.AiChatResponse parseModelContent(String modelContent) throws Exception {
        String responseBody = objectMapper.writeValueAsString(Map.of(
                "choices", List.of(Map.of("message", Map.of("content", modelContent)))
        ));
        return ReflectionTestUtils.invokeMethod(aiService, "parseOpenAiResponse", responseBody);
    }
}

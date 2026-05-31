package com.cocanvas.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;

@Service
public class AiService {

    private static final Logger log = LoggerFactory.getLogger(AiService.class);

    // ── System prompt ─────────────────────────────────────────────────────────
    private static final String SYSTEM_PROMPT = """
            你是 Cocanvas 协作白板中的 AI 助手。Cocanvas 是一个支持多人实时协作的产品思维白板，\
            专门用于产品团队在会议中进行发散、归类、投票和决策。

            你的职责是根据当前会议阶段和白板已有内容，帮助团队生成结构化的白板内容。

            ## 输出格式（严格遵守）

            你必须始终以合法 JSON 回复，不要有任何额外文字，不要用 markdown 代码块包裹：
            {"message":"简短说明（1-3句，中文）","ops":[]}

            ## ShapeOperation 类型

            ### 卡片 card — 最常用，用于想法、行动项、风险
            {"opType":"create","shapeId":"ai-card-N","shapeType":"card","attrs":{"x":0,"y":0,"w":260,"h":168,"title":"标题","body":"详细描述，具体可执行","tags":["标签"],"priority":"medium","status":"idea","fill":"#dcfce7","stroke":"#15803d","textColor":"#111827","fontSize":16,"cornerRadius":8,"strokeWidth":2}}

            ### 框架 frame — 用于列分组
            {"opType":"create","shapeId":"ai-frame-N","shapeType":"frame","attrs":{"x":0,"y":0,"w":280,"h":460,"text":"列名","fill":"rgba(255,255,255,0.02)","textColor":"#334155","fontSize":20,"stroke":"#64748b","strokeWidth":2,"zIndex":-10}}

            ### 大标题 text — 放在 frame 上方 66px
            {"opType":"create","shapeId":"ai-text-N","shapeType":"text","attrs":{"x":0,"y":0,"w":740,"h":48,"text":"标题","fill":"transparent","stroke":"transparent","strokeWidth":0,"textColor":"#0f172a","fontSize":28,"fontStyle":"bold","zIndex":-4}}

            ### 便利贴 sticky — 快速想法
            {"opType":"create","shapeId":"ai-sticky-N","shapeType":"sticky","attrs":{"x":0,"y":0,"w":190,"h":170,"text":"内容","fill":"#ffd966","stroke":"transparent","textColor":"#202124","fontSize":22,"cornerRadius":10,"strokeWidth":0}}

            ## 颜色规则（card priority）
            - low:    fill "#e0f2fe", stroke "#0369a1"
            - medium: fill "#dcfce7", stroke "#15803d"
            - high:   fill "#fef3c7", stroke "#b45309"
            - urgent: fill "#ffe4e6", stroke "#be123c"

            ## 布局规则
            - context 中会给出"建议起始坐标 x, y"，从此坐标开始放置
            - 列布局：frame 宽 280px，列间距 40px，即下一列 x += 320
            - 卡片在 frame 内：x = frame.x+20, 首张 y = frame.y+58, 之后 y += 188
            - text 标题：y = frame.y-66（整组标题放第一个 frame 上方）
            - sticky 布局：间距 210px 横向排列，3-4列
            - 每次生成 4-8 个 op，内容具体，避免空话

            ## 会议阶段对应模板
            - 准备议题 → 生成目标/用户/范围/风险/决策/行动项六列卡片
            - 发散想法 → 生成多列便利贴（问题、假设、机会、实验）
            - 归类收敛 → 带 frame 分组（主题/旅程/象限）
            - 投票排序 → ICE 三列（Impact/Confidence/Ease）
            - 形成决策 → 决策矩阵四象限（高影响高信心/低信心/低影响/谨慎决策）
            - 行动项   → 看板三列（Backlog/Doing/Done）

            ## 标签建议
            Insight、Risk、User、Tech、Growth、Decision、Experiment、Follow-up

            重要：只输出 JSON，不包含任何其他内容。
            """;

    @Value("${ai.api-key:}")
    private String apiKey;

    @Value("${ai.api-url:https://api.deepseek.com/chat/completions}")
    private String apiUrl;

    @Value("${ai.model:deepseek-chat}")
    private String model;

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;

    public AiService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newHttpClient();
    }

    public record AiChatRequest(String prompt, String boardContext) {}

    public record AiChatResponse(String message, List<Map<String, Object>> ops) {}

    public AiChatResponse chat(AiChatRequest request) {
        if (apiKey == null || apiKey.isBlank()) {
            return new AiChatResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。", List.of());
        }

        try {
            String userContent = "【当前白板信息】\n" + request.boardContext()
                    + "\n\n【用户请求】\n" + request.prompt();

            // OpenAI-compatible request body (works for DeepSeek)
            String requestBody = objectMapper.writeValueAsString(Map.of(
                    "model", model,
                    "max_tokens", 4096,
                    "messages", List.of(
                            Map.of("role", "system", "content", SYSTEM_PROMPT),
                            Map.of("role", "user", "content", userContent)
                    )
            ));

            HttpRequest httpRequest = HttpRequest.newBuilder()
                    .uri(URI.create(apiUrl))
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                    .build();

            HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() != 200) {
                log.warn("AI API error {}: {}", response.statusCode(), response.body());
                return new AiChatResponse("AI 请求失败（状态 " + response.statusCode() + "），请稍后重试。", List.of());
            }

            return parseOpenAiResponse(response.body());

        } catch (Exception e) {
            log.error("AI chat error", e);
            return new AiChatResponse("AI 响应出错：" + e.getMessage(), List.of());
        }
    }

    @SuppressWarnings("unchecked")
    private AiChatResponse parseOpenAiResponse(String responseBody) throws Exception {
        JsonNode root = objectMapper.readTree(responseBody);
        String rawText = root.path("choices").path(0).path("message").path("content").asText("");

        // Strip markdown fences if model wrapped the JSON
        String json = rawText.strip();
        if (json.startsWith("```")) {
            json = json.replaceAll("(?s)^```[a-z]*\\s*", "").replaceAll("```\\s*$", "").strip();
        }

        JsonNode parsed = objectMapper.readTree(json);
        String message = parsed.path("message").asText("已生成内容。");

        List<Map<String, Object>> ops = List.of();
        JsonNode opsNode = parsed.path("ops");
        if (opsNode.isArray() && !opsNode.isEmpty()) {
            List<Map<String, Object>> rawOps = objectMapper.convertValue(
                    opsNode,
                    objectMapper.getTypeFactory().constructCollectionType(List.class, Map.class)
            );
            // Replace placeholder shapeIds with real UUIDs to prevent collisions
            ops = rawOps.stream().map(op -> {
                Map<String, Object> copy = new java.util.LinkedHashMap<>(op);
                copy.put("shapeId", "ai-" + UUID.randomUUID().toString().substring(0, 8));
                return copy;
            }).toList();
        }

        return new AiChatResponse(message, ops);
    }
}

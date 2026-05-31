package com.cocanvas.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.net.http.HttpTimeoutException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Service
public class AiService {

    private static final Logger log = LoggerFactory.getLogger(AiService.class);
    private static final int MAX_ERROR_BODY_CHARS = 600;
    private static final int MAX_MESSAGE_CHARS = 600;
    private static final Set<String> ALLOWED_SHAPE_TYPES = Set.of("card", "sticky", "text", "frame");
    private static final Set<String> STRING_ATTRS = Set.of(
            "fill", "stroke", "text", "textColor", "fontStyle", "title", "body", "assignee"
    );
    private static final Set<String> NUMBER_ATTRS = Set.of(
            "x", "y", "w", "h", "radius", "strokeWidth", "fontSize", "cornerRadius", "zIndex", "votes"
    );
    private static final Set<String> BOOLEAN_ATTRS = Set.of("resolved", "arrowEnd");

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

    @Value("${ai.timeout-ms:20000}")
    private long timeoutMs;

    @Value("${ai.max-tokens:2048}")
    private int maxTokens;

    @Value("${ai.max-prompt-chars:4000}")
    private int maxPromptChars;

    @Value("${ai.max-context-chars:12000}")
    private int maxContextChars;

    @Value("${ai.max-ops:8}")
    private int maxOps;

    @Value("${ai.rate-limit-window-ms:60000}")
    private long rateLimitWindowMs;

    @Value("${ai.rate-limit-max-requests:8}")
    private int rateLimitMaxRequests;

    private final ObjectMapper objectMapper;
    private final HttpClient httpClient;
    private final ConcurrentMap<String, RateLimitBucket> rateLimits = new ConcurrentHashMap<>();

    public AiService(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(5))
                .build();
    }

    public record AiChatRequest(String prompt, String boardContext) {}

    public record AiChatResponse(String message, List<Map<String, Object>> ops) {}

    public AiChatResponse chat(String roomId, AiChatRequest request) {
        String prompt = trimToLimit(request == null ? "" : request.prompt(), maxPromptChars);
        if (prompt.isBlank()) {
            return new AiChatResponse("请输入要让 AI 协助处理的问题。", List.of());
        }

        if (apiKey == null || apiKey.isBlank()) {
            return new AiChatResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。", List.of());
        }

        if (!allowRequest(roomId)) {
            return new AiChatResponse("AI 请求过于频繁，请稍等一分钟后再试。", List.of());
        }

        String boardContext = trimToLimit(request == null ? "" : request.boardContext(), maxContextChars);

        try {
            String userContent = "【当前白板信息】\n" + boardContext
                    + "\n\n【用户请求】\n" + prompt;

            // OpenAI-compatible request body (works for DeepSeek)
            Map<String, Object> requestPayload = new LinkedHashMap<>();
            requestPayload.put("model", model);
            requestPayload.put("max_tokens", clamp(maxTokens, 256, 4096));
            requestPayload.put("temperature", 0.35);
            requestPayload.put("messages", List.of(
                    Map.of("role", "system", "content", SYSTEM_PROMPT),
                    Map.of("role", "user", "content", userContent)
            ));
            String requestBody = objectMapper.writeValueAsString(requestPayload);

            HttpRequest httpRequest = HttpRequest.newBuilder()
                    .uri(URI.create(apiUrl))
                    .timeout(requestTimeout())
                    .header("Content-Type", "application/json")
                    .header("Authorization", "Bearer " + apiKey)
                    .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                    .build();

            HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());

            if (response.statusCode() < 200 || response.statusCode() >= 300) {
                log.warn("AI API error {}: {}", response.statusCode(), abbreviate(response.body(), MAX_ERROR_BODY_CHARS));
                return new AiChatResponse("AI 请求失败（状态 " + response.statusCode() + "），请稍后重试。", List.of());
            }

            return parseOpenAiResponse(response.body());

        } catch (HttpTimeoutException e) {
            log.warn("AI request timeout for room {}", roomId);
            return new AiChatResponse("AI 请求超时，请稍后重试或缩短输入内容。", List.of());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("AI request interrupted for room {}", roomId);
            return new AiChatResponse("AI 请求已中断，请稍后重试。", List.of());
        } catch (Exception e) {
            log.error("AI chat error", e);
            return new AiChatResponse("AI 响应暂时不可用，请稍后重试。", List.of());
        }
    }

    private AiChatResponse parseOpenAiResponse(String responseBody) {
        try {
            JsonNode root = objectMapper.readTree(responseBody);
            String rawText = root.path("choices").path(0).path("message").path("content").asText("");
            if (rawText.isBlank()) {
                return new AiChatResponse("AI 没有返回可解析的内容，请重试。", List.of());
            }

            JsonNode parsed = objectMapper.readTree(extractJson(rawText));
            String message = trimToLimit(parsed.path("message").asText("已生成内容。"), MAX_MESSAGE_CHARS);

            List<Map<String, Object>> ops = sanitizeOps(parsed.path("ops"));
            String suffix = ops.isEmpty() ? "" : "（已安全校验 " + ops.size() + " 个图形操作）";
            return new AiChatResponse(message + suffix, ops);
        } catch (Exception e) {
            log.warn("AI response parse failed: {}", e.getMessage());
            return new AiChatResponse("AI 返回格式不稳定，已安全忽略本次内容，请重试。", List.of());
        }
    }

    private List<Map<String, Object>> sanitizeOps(JsonNode opsNode) {
        List<Map<String, Object>> ops = List.of();
        if (opsNode.isArray() && !opsNode.isEmpty()) {
            List<Map<String, Object>> sanitized = new ArrayList<>();
            for (JsonNode opNode : opsNode) {
                if (sanitized.size() >= clamp(maxOps, 1, 20)) {
                    break;
                }

                Map<String, Object> op = sanitizeOp(opNode, sanitized.size());
                if (!op.isEmpty()) {
                    sanitized.add(op);
                }
            }
            ops = sanitized;
        }

        return ops;
    }

    private Map<String, Object> sanitizeOp(JsonNode opNode, int index) {
        if (!opNode.isObject()) {
            return Map.of();
        }

        String opType = opNode.path("opType").asText("");
        String shapeType = opNode.path("shapeType").asText("");
        if (!"create".equals(opType) || !ALLOWED_SHAPE_TYPES.contains(shapeType)) {
            return Map.of();
        }

        Map<String, Object> attrs = sanitizeAttrs(opNode.path("attrs"), shapeType, index);
        if (attrs.isEmpty()) {
            return Map.of();
        }

        Map<String, Object> op = new LinkedHashMap<>();
        op.put("opType", "create");
        op.put("shapeId", "ai-" + UUID.randomUUID().toString().substring(0, 8));
        op.put("shapeType", shapeType);
        op.put("attrs", attrs);
        return op;
    }

    private Map<String, Object> sanitizeAttrs(JsonNode attrsNode, String shapeType, int index) {
        Map<String, Object> attrs = new LinkedHashMap<>();
        if (attrsNode.isObject()) {
            attrsNode.fields().forEachRemaining(entry -> {
                String key = entry.getKey();
                JsonNode value = entry.getValue();
                if (STRING_ATTRS.contains(key) && value.isTextual()) {
                    attrs.put(key, trimToLimit(value.asText(), 500));
                } else if (NUMBER_ATTRS.contains(key) && value.isNumber()) {
                    attrs.put(key, clampNumber(key, value.asDouble()));
                } else if (BOOLEAN_ATTRS.contains(key) && value.isBoolean()) {
                    attrs.put(key, value.asBoolean());
                } else if (("tags".equals(key) || "voters".equals(key)) && value.isArray()) {
                    attrs.put(key, sanitizeStringArray(value));
                } else if ("priority".equals(key) && value.isTextual()) {
                    attrs.put(key, sanitizeEnum(value.asText(), Set.of("low", "medium", "high", "urgent"), "medium"));
                } else if ("status".equals(key) && value.isTextual()) {
                    attrs.put(key, sanitizeEnum(value.asText(), Set.of("idea", "todo", "doing", "done", "blocked"), "idea"));
                }
            });
        }

        attrs.putIfAbsent("x", 220 + index * 36);
        attrs.putIfAbsent("y", 180 + index * 36);
        applyShapeDefaults(attrs, shapeType);
        return attrs;
    }

    private void applyShapeDefaults(Map<String, Object> attrs, String shapeType) {
        if ("card".equals(shapeType)) {
            attrs.putIfAbsent("w", 260);
            attrs.putIfAbsent("h", 168);
            attrs.putIfAbsent("title", "AI 生成卡片");
            attrs.putIfAbsent("body", "补充更多细节后即可用于讨论。");
            attrs.putIfAbsent("tags", List.of("AI"));
            attrs.putIfAbsent("priority", "medium");
            attrs.putIfAbsent("status", "idea");
            attrs.putIfAbsent("fill", "#dcfce7");
            attrs.putIfAbsent("stroke", "#15803d");
            attrs.putIfAbsent("textColor", "#111827");
            attrs.putIfAbsent("fontSize", 16);
            attrs.putIfAbsent("cornerRadius", 8);
            attrs.putIfAbsent("strokeWidth", 2);
        } else if ("sticky".equals(shapeType)) {
            attrs.putIfAbsent("w", 190);
            attrs.putIfAbsent("h", 170);
            attrs.putIfAbsent("text", "AI idea");
            attrs.putIfAbsent("fill", "#ffd966");
            attrs.putIfAbsent("stroke", "transparent");
            attrs.putIfAbsent("textColor", "#202124");
            attrs.putIfAbsent("fontSize", 22);
            attrs.putIfAbsent("cornerRadius", 10);
            attrs.putIfAbsent("strokeWidth", 0);
        } else if ("text".equals(shapeType)) {
            attrs.putIfAbsent("w", 740);
            attrs.putIfAbsent("h", 48);
            attrs.putIfAbsent("text", "AI 生成内容");
            attrs.putIfAbsent("fill", "transparent");
            attrs.putIfAbsent("stroke", "transparent");
            attrs.putIfAbsent("strokeWidth", 0);
            attrs.putIfAbsent("textColor", "#0f172a");
            attrs.putIfAbsent("fontSize", 28);
            attrs.putIfAbsent("fontStyle", "bold");
        } else if ("frame".equals(shapeType)) {
            attrs.putIfAbsent("w", 280);
            attrs.putIfAbsent("h", 460);
            attrs.putIfAbsent("text", "AI 分组");
            attrs.putIfAbsent("fill", "rgba(255,255,255,0.02)");
            attrs.putIfAbsent("stroke", "#64748b");
            attrs.putIfAbsent("strokeWidth", 2);
            attrs.putIfAbsent("textColor", "#334155");
            attrs.putIfAbsent("fontSize", 20);
            attrs.putIfAbsent("zIndex", -10);
        }
    }

    private boolean allowRequest(String roomId) {
        long now = System.currentTimeMillis();
        long windowMs = Math.max(1_000L, rateLimitWindowMs);
        int maxRequests = clamp(rateLimitMaxRequests, 1, 120);
        String key = roomId == null || roomId.isBlank() ? "unknown" : roomId;
        RateLimitBucket bucket = rateLimits.compute(key, (ignored, current) -> {
            if (current == null || now - current.windowStartMs() >= windowMs) {
                return new RateLimitBucket(now, 1);
            }
            return new RateLimitBucket(current.windowStartMs(), current.count() + 1);
        });

        pruneOldRateLimits(now, windowMs);
        return bucket != null && bucket.count() <= maxRequests;
    }

    private void pruneOldRateLimits(long now, long windowMs) {
        if (rateLimits.size() < 1_000) {
            return;
        }
        rateLimits.entrySet().removeIf(entry -> now - entry.getValue().windowStartMs() > windowMs * 2);
    }

    private String extractJson(String rawText) {
        String json = rawText.strip();
        if (json.startsWith("```")) {
            json = json.replaceAll("(?s)^```[a-zA-Z]*\\s*", "").replaceAll("```\\s*$", "").strip();
        }
        if (!json.startsWith("{")) {
            int start = json.indexOf('{');
            int end = json.lastIndexOf('}');
            if (start >= 0 && end > start) {
                json = json.substring(start, end + 1);
            }
        }
        return json;
    }

    private List<String> sanitizeStringArray(JsonNode value) {
        List<String> result = new ArrayList<>();
        for (JsonNode item : value) {
            if (result.size() >= 8) {
                break;
            }
            if (item.isTextual()) {
                String text = trimToLimit(item.asText(), 40);
                if (!text.isBlank()) {
                    result.add(text);
                }
            }
        }
        return result;
    }

    private String sanitizeEnum(String value, Set<String> allowed, String fallback) {
        String cleaned = value == null ? "" : value.trim().toLowerCase();
        return allowed.contains(cleaned) ? cleaned : fallback;
    }

    private Object clampNumber(String key, double value) {
        if ("x".equals(key) || "y".equals(key)) {
            return Math.round(Math.max(-100_000, Math.min(100_000, value)));
        }
        if ("w".equals(key) || "h".equals(key)) {
            return Math.round(Math.max(20, Math.min(2_000, value)));
        }
        if ("fontSize".equals(key)) {
            return Math.round(Math.max(8, Math.min(72, value)));
        }
        if ("strokeWidth".equals(key)) {
            return Math.round(Math.max(0, Math.min(24, value)));
        }
        if ("cornerRadius".equals(key) || "radius".equals(key)) {
            return Math.round(Math.max(0, Math.min(300, value)));
        }
        if ("zIndex".equals(key)) {
            return Math.round(Math.max(-1_000, Math.min(1_000, value)));
        }
        if ("votes".equals(key)) {
            return Math.round(Math.max(0, Math.min(999, value)));
        }
        return value;
    }

    private Duration requestTimeout() {
        return Duration.ofMillis(Math.max(2_000L, Math.min(timeoutMs, 120_000L)));
    }

    private int clamp(int value, int min, int max) {
        return Math.max(min, Math.min(max, value));
    }

    private String trimToLimit(String value, int limit) {
        if (value == null) {
            return "";
        }
        int safeLimit = Math.max(1, limit);
        String trimmed = value.trim();
        if (trimmed.length() <= safeLimit) {
            return trimmed;
        }
        return trimmed.substring(0, safeLimit) + "\n...（内容已裁剪）";
    }

    private String abbreviate(String value, int limit) {
        if (value == null || value.length() <= limit) {
            return value;
        }
        return value.substring(0, limit) + "...";
    }

    private record RateLimitBucket(long windowStartMs, int count) {}
}

package com.cocanvas.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Duration;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;

@Service
public class AiService {

    private static final Logger log = LoggerFactory.getLogger(AiService.class);
    private static final int MAX_AI_OPS = 120;
    private static final Set<String> ALLOWED_OP_TYPES = Set.of("create", "update", "delete");
    private static final Set<String> ALLOWED_SHAPE_TYPES = Set.of(
            "rect", "roundedRect", "circle", "diamond", "triangle", "text",
            "sticky", "connector", "pen", "comment", "frame", "card"
    );

    // ── System prompt ─────────────────────────────────────────────────────────
    private static final String SYSTEM_PROMPT = """
            你是 Cocanvas 协作白板中的 AI 助手。Cocanvas 是一个支持多人实时协作的产品思维白板，\
            专门用于产品团队在会议中进行发散、归类、投票和决策。

            你的职责是根据当前会议阶段、白板已有内容和用户请求，对白板进行【创建 / 修改 / 删除】操作。

            ## 输出格式（严格遵守）
            只输出合法 JSON，不要有任何额外文字，不要用 markdown 代码块包裹：
            {"message":"简短说明（1-3句，中文）","ops":[]}

            ## 三种操作 opType

            ### 1. create — 新建图形
            shapeId 用占位符（如 "ai-card-1"），系统会自动分配真实 ID。
            连接线引用 create 出来的图形时，用同样的占位符即可，系统会自动映射。

            ### 2. update — 修改已有图形
            shapeId 必须是【当前白板信息】中列出的真实 ID（如 "card-abc123"）。
            attrs 里只需写要改的字段，未写的字段保持不变。
            例：把某卡片标记为已完成并提升优先级
            {"opType":"update","shapeId":"card-abc123","shapeType":"card","attrs":{"status":"done","priority":"high","fill":"#fef3c7","stroke":"#b45309"}}
            例：修改卡片文字
            {"opType":"update","shapeId":"card-abc123","shapeType":"card","attrs":{"title":"新标题","body":"新描述"}}
            例：移动图形位置
            {"opType":"update","shapeId":"card-abc123","shapeType":"card","attrs":{"x":600,"y":200}}

            ### 3. delete — 删除图形
            {"opType":"delete","shapeId":"card-abc123","shapeType":"card"}

            ## 图形类型（create 时 shapeType 可选值）

            ### card 卡片 — 想法/行动项/风险，最常用
            {"opType":"create","shapeId":"ai-card-1","shapeType":"card","attrs":{"x":0,"y":0,"w":260,"h":168,"title":"标题","body":"具体可执行的描述","tags":["标签"],"priority":"medium","status":"idea","fill":"#dcfce7","stroke":"#15803d","textColor":"#111827","fontSize":16,"cornerRadius":8,"strokeWidth":2}}

            ### sticky 便利贴 — 快速想法
            {"opType":"create","shapeId":"ai-sticky-1","shapeType":"sticky","attrs":{"x":0,"y":0,"w":190,"h":170,"text":"内容","fill":"#ffd966","stroke":"transparent","textColor":"#202124","fontSize":22,"cornerRadius":10,"strokeWidth":0}}

            ### frame 框架 — 列/区域分组容器（zIndex 设负数，作为背景）
            {"opType":"create","shapeId":"ai-frame-1","shapeType":"frame","attrs":{"x":0,"y":0,"w":280,"h":460,"text":"列名","fill":"rgba(255,255,255,0.02)","textColor":"#334155","fontSize":20,"stroke":"#64748b","strokeWidth":2,"zIndex":-10}}

            ### text 大标题 — 标题文字（透明背景）
            {"opType":"create","shapeId":"ai-text-1","shapeType":"text","attrs":{"x":0,"y":0,"w":740,"h":48,"text":"标题","fill":"transparent","stroke":"transparent","strokeWidth":0,"textColor":"#0f172a","fontSize":28,"fontStyle":"bold","zIndex":-4}}

            ### connector 连接线/箭头 — 表达流程、依赖、因果关系
            必须指定 fromShapeId / toShapeId（连接两个图形），可用 create 占位符或已有真实 ID。
            anchor 可选 top/right/bottom/left/center。
            {"opType":"create","shapeId":"ai-conn-1","shapeType":"connector","attrs":{"fromShapeId":"ai-card-1","toShapeId":"ai-card-2","fromAnchor":"right","toAnchor":"left","stroke":"#475569","strokeWidth":2,"fill":"transparent","arrowEnd":true,"zIndex":-2}}

            ### rect / roundedRect / circle / diamond / triangle 几何图形 — 流程图、示意图
            rect/roundedRect/diamond/triangle 用 w/h；circle 用 radius。可放 text 作为标签。
            {"opType":"create","shapeId":"ai-rect-1","shapeType":"rect","attrs":{"x":0,"y":0,"w":160,"h":80,"text":"步骤","fill":"#dbeafe","stroke":"#2563eb","strokeWidth":2,"textColor":"#1e3a8a","fontSize":16}}
            {"opType":"create","shapeId":"ai-diamond-1","shapeType":"diamond","attrs":{"x":0,"y":0,"w":160,"h":120,"text":"判断?","fill":"#fef9c3","stroke":"#ca8a04","strokeWidth":2,"textColor":"#713f12","fontSize":15}}
            {"opType":"create","shapeId":"ai-circle-1","shapeType":"circle","attrs":{"x":0,"y":0,"radius":50,"text":"开始","fill":"#dcfce7","stroke":"#16a34a","strokeWidth":2,"textColor":"#14532d","fontSize":14}}

            ### comment 批注
            {"opType":"create","shapeId":"ai-comment-1","shapeType":"comment","attrs":{"x":0,"y":0,"w":220,"h":86,"text":"批注内容","fill":"#ffffff","stroke":"#e5e7eb","strokeWidth":1,"textColor":"#111827","fontSize":14,"cornerRadius":8}}

            ## 颜色规则（card priority）
            - low:    fill "#e0f2fe", stroke "#0369a1"
            - medium: fill "#dcfce7", stroke "#15803d"
            - high:   fill "#fef3c7", stroke "#b45309"
            - urgent: fill "#ffe4e6", stroke "#be123c"

            ## 布局规则
            - 【当前白板信息】会给出"建议起始坐标 x, y"，新建内容从此坐标开始，避免与已有图形重叠
            - 列布局：frame 宽 280px，列间距 40px（下一列 x += 320）
            - 卡片在 frame 内：x = frame.x+20，首张 y = frame.y+58，之后每张 y += 188
            - text 标题：y = frame.y-66
            - sticky：横向间距 210px，3-4 列换行
            - 流程图：节点横向间距约 220px，用 connector 串联，circle 起止、rect 步骤、diamond 判断
            - 内容要具体可执行，避免空话套话

            ## 复杂场景能力（重要）
            你不仅能套用固定模板，更要能处理复杂、开放的请求：
            - 用户要"改/调整/补充/优化/删除/整理"现有内容时，用 update/delete 操作对应 shapeId
            - 用户要"画流程图/架构图/思维导图/关系图"时，组合几何图形 + connector
            - 用户要"按某维度重新归类"时，可新建 frame 并 update 移动已有卡片的 x/y 到对应区域
            - 可以一次返回混合的 create/update/delete 操作，数量不限，以真正完成用户意图为准

            ## 会议阶段参考模板（仅作灵感，不必拘泥）
            - 准备议题 → 目标/用户/范围/风险/决策/行动项卡片
            - 发散想法 → 多列便利贴
            - 归类收敛 → frame 分组
            - 投票排序 → ICE 三列
            - 形成决策 → 决策矩阵四象限
            - 行动项   → 看板三列

            ## 标签建议
            Insight、Risk、User、Tech、Growth、Decision、Experiment、Follow-up

            ## 尺寸规则（避免文字被遮挡，重要）
            - card 最小尺寸 240x180；正文较多时增大到 280x220 甚至更大
            - frame 至少 280x420
            - 文字越多，w/h 要越大；宁可大一点，不要让文字被裁切
            - 不要生成小于 200x140 的卡片

            重要：只输出 JSON，不包含任何其他内容。
            """;

    // ── Planner 主 AI 提示词 ────────────────────────────────────────────────────
    private static final String PLANNER_PROMPT = """
            你是 Cocanvas 白板的【规划主 AI】。你的任务不是直接画图，而是把用户的请求拆解成若干\
            互不重叠的区域，交给多个子 AI 分别生成，最后合并。

            ## 判断策略
            - 如果请求是简单的修改/删除/少量新增（如"把某卡片标红""加一张卡片"），strategy 设为 "direct"。
            - 如果请求需要生成较多内容、且可自然拆分为多个主题区域（如"完整的产品评审看板""竞品分析全景图"\
              "包含流程图和风险表的方案"），strategy 设为 "multi"，并划分 2-4 个区域。

            ## 区域空间规划（关键）
            - 各区域必须【互不重叠】，按从左到右、从上到下的网格排布。
            - 每个区域给出 x, y, width, height。建议每个区域宽 900-1100，高 600-800。
            - 横向排列时下一个区域 x = 上一个 x + width + 80；需要换行时 y += height + 80，x 回到起点。
            - 起点建议 x=200, y=120。

            ## 输出格式（只输出 JSON，无其他文字）
            {"strategy":"multi","regions":[
              {"title":"区域标题","theme":"该区域要生成什么内容的详细说明","x":200,"y":120,"width":1000,"height":700},
              {"title":"...","theme":"...","x":1280,"y":120,"width":1000,"height":700}
            ]}
            或简单请求：{"strategy":"direct","regions":[]}
            """;

    // ── Merge 合并 AI 提示词 ────────────────────────────────────────────────────
    private static final String MERGE_PROMPT = """
            你是 Cocanvas 白板的【合并 AI】。多个子 AI 已经在各自区域生成了节点，现在给你各区域\
            产出的节点 id 列表。你的任务是：用连接线（connector）把【跨区域】有逻辑关系的节点连起来，\
            并在最顶部加一个总标题 text，让整张图成为一个有机整体。

            ## 规则
            - connector 必须指定 fromShapeId / toShapeId，使用列表中给出的真实 id（不要编造 id）。
            - 只连接确有关系的节点，不要把所有节点都连起来；通常 2-5 条跨区域连线即可。
            - 总标题 text 放在 x=200, y=40 附近，fontSize=32。
            - 如果各区域之间没有明显关系，ops 可以只包含总标题，或为空数组。

            ## connector 格式
            {"opType":"create","shapeId":"ai-merge-conn-1","shapeType":"connector","attrs":{"fromShapeId":"真实id","toShapeId":"真实id","fromAnchor":"right","toAnchor":"left","stroke":"#475569","strokeWidth":2,"fill":"transparent","arrowEnd":true,"zIndex":-2}}

            ## 输出格式（只输出 JSON，无其他文字）
            {"message":"简短中文说明","ops":[]}
            """;

    private static final String SUMMARY_PROMPT = """
            你是 Cocanvas 协作白板中的会议纪要助手。请根据用户给你的白板上下文生成一份可直接会后同步的\
            Markdown 会议总结。

            要求：
            - 直接输出 Markdown 文本，不要输出 JSON，不要使用代码块包裹。
            - 内容要具体，尽量引用白板中的卡片、风险、行动项和会议阶段。
            - 如果白板内容不足，也要明确说明信息不足，并给出下一步建议。
            - 使用以下结构：
              # 会议总结
              ## 核心结论
              ## 主要风险 / 待决策
              ## 行动项
              ## 进展评估
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
        this.httpClient = HttpClient.newBuilder()
                .connectTimeout(Duration.ofSeconds(15))
                .build();
    }

    public record AiChatRequest(String prompt, String boardContext) {}

    public record AiChatResponse(String message, List<Map<String, Object>> ops) {}

    public record AiSummaryResponse(String markdown) {}

    // ── Single-shot chat (create/update/delete in one model call) ──────────────
    public AiChatResponse chat(AiChatRequest request) {
        if (apiKey == null || apiKey.isBlank()) {
            return new AiChatResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。", List.of());
        }
        try {
            String userContent = "【当前白板信息】\n" + request.boardContext()
                    + "\n\n【用户请求】\n" + request.prompt();
            String content = callModel(SYSTEM_PROMPT, userContent);
            JsonNode parsed = objectMapper.readTree(extractJsonObject(content));
            String message = parsed.path("message").asText("已生成内容。");
            return new AiChatResponse(message, prepareOps(parsed.path("ops")));
        } catch (Exception e) {
            log.error("AI chat error", e);
            return new AiChatResponse("AI 响应出错：" + e.getMessage(), List.of());
        }
    }

    public AiSummaryResponse summarize(AiChatRequest request) {
        if (apiKey == null || apiKey.isBlank()) {
            return new AiSummaryResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。");
        }
        try {
            String userContent = "【当前白板信息】\n" + request.boardContext()
                    + "\n\n【总结要求】\n" + request.prompt();
            String markdown = stripFences(callModel(SUMMARY_PROMPT, userContent)).strip();
            return new AiSummaryResponse(markdown.isBlank() ? "AI 未返回会议总结。" : markdown);
        } catch (Exception e) {
            log.error("AI summarize error", e);
            return new AiSummaryResponse("AI 总结出错：" + e.getMessage());
        }
    }

    // ── LangChain-style multi-agent orchestration ──────────────────────────────
    // 1) Planner 主 AI：决定划分多少区域、各区域主题与互不重叠的边界框
    // 2) 多个 Sub AI：并行在各自边界框内生成内容
    // 3) Merge AI：根据各区域产出，补充跨区域连接线与总标题
    public AiChatResponse orchestrate(AiChatRequest request) {
        if (apiKey == null || apiKey.isBlank()) {
            return new AiChatResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。", List.of());
        }
        try {
            // ── Step 1: Planner ──
            String plannerUser = "【当前白板信息】\n" + request.boardContext()
                    + "\n\n【用户请求】\n" + request.prompt();
            JsonNode plan = objectMapper.readTree(extractJsonObject(callModel(PLANNER_PROMPT, plannerUser)));
            String strategy = plan.path("strategy").asText("direct");
            JsonNode regions = plan.path("regions");

            // 简单/修改类请求 → 退回单次调用
            if (!"multi".equals(strategy) || !regions.isArray() || regions.size() < 2) {
                return chat(request);
            }

            // ── Step 2: 各区域并行生成 ──
            List<JsonNode> regionList = new ArrayList<>();
            for (JsonNode region : regions) {
                if (regionList.size() >= 4) {
                    break;
                }
                regionList.add(region);
            }

            List<CompletableFuture<List<Map<String, Object>>>> futures = new ArrayList<>();
            for (JsonNode region : regionList) {
                futures.add(CompletableFuture.supplyAsync(() -> generateRegion(region, request.prompt())));
            }

            List<Map<String, Object>> allOps = new ArrayList<>();
            // 收集每个区域产出的关键节点，供 Merge 引用
            StringBuilder nodeSummary = new StringBuilder();
            for (int i = 0; i < futures.size(); i++) {
                List<Map<String, Object>> regionOps = futures.get(i).join();
                allOps.addAll(regionOps);
                String title = regionList.get(i).path("title").asText("区域" + (i + 1));
                nodeSummary.append("区域【").append(title).append("】节点：\n");
                for (Map<String, Object> op : regionOps) {
                    if ("create".equals(op.get("opType"))) {
                        Object attrs = op.get("attrs");
                        String label = "";
                        if (attrs instanceof Map<?, ?> a) {
                            Object t = a.get("title");
                            if (t == null) t = a.get("text");
                            label = t == null ? "" : String.valueOf(t);
                        }
                        nodeSummary.append("  - ").append(op.get("shapeId"))
                                .append(" [").append(op.get("shapeType")).append("] ")
                                .append(label).append("\n");
                    }
                }
            }

            // ── Step 3: Merge ──
            String mergeUser = "用户原始目标：" + request.prompt()
                    + "\n\n各子区域已生成以下节点（id 可用于连接线）：\n" + nodeSummary;
            String mergeMsg = "已通过多智能体协作完成：规划 " + regionList.size() + " 个区域并合并。";
            try {
                JsonNode merge = objectMapper.readTree(extractJsonObject(callModel(MERGE_PROMPT, mergeUser)));
                mergeMsg = merge.path("message").asText(mergeMsg);
                // Merge 产出的连接线/标题引用的是已存在的真实 id，remapOps 只会给它自己 create 的新图形换 id
                allOps.addAll(prepareOps(merge.path("ops")));
            } catch (Exception e) {
                log.warn("Merge step failed, returning region ops only: {}", e.getMessage());
            }

            return new AiChatResponse(mergeMsg, allOps);
        } catch (Exception e) {
            log.error("AI orchestrate error", e);
            // 编排失败时优雅降级为单次调用
            return chat(request);
        }
    }

    private List<Map<String, Object>> generateRegion(JsonNode region, String userGoal) {
        try {
            int rx = region.path("x").asInt(200);
            int ry = region.path("y").asInt(120);
            int rw = region.path("width").asInt(900);
            int rh = region.path("height").asInt(640);
            String title = region.path("title").asText("区域");
            String theme = region.path("theme").asText("");

            String sub = "用户整体目标：" + userGoal
                    + "\n\n你只负责生成【" + title + "】这一个区域的内容。"
                    + "\n区域主题/要求：" + theme
                    + "\n区域边界框：x ∈ [" + rx + ", " + (rx + rw) + "]，y ∈ [" + ry + ", " + (ry + rh) + "]。"
                    + "\n所有图形必须落在此边界框内，从 x=" + (rx + 24) + ", y=" + (ry + 56) + " 开始排布，互不重叠。"
                    + "\n在区域顶部用一个 text 标题标注【" + title + "】（y=" + ry + "）。";
            JsonNode parsed = objectMapper.readTree(extractJsonObject(callModel(SYSTEM_PROMPT, sub)));
            return prepareOps(parsed.path("ops"));
        } catch (Exception e) {
            log.warn("Region generation failed: {}", e.getMessage());
            return List.of();
        }
    }

    // ── Low-level model call (OpenAI-compatible, works for DeepSeek) ────────────
    private String callModel(String systemPrompt, String userContent) throws Exception {
        String requestBody = objectMapper.writeValueAsString(Map.of(
                "model", model,
                "max_tokens", 4096,
                "temperature", 0.2,
                "messages", List.of(
                        Map.of("role", "system", "content", systemPrompt),
                        Map.of("role", "user", "content", userContent)
                )
        ));
        HttpRequest httpRequest = HttpRequest.newBuilder()
                .uri(URI.create(apiUrl))
                .timeout(Duration.ofSeconds(75))
                .header("Content-Type", "application/json")
                .header("Authorization", "Bearer " + apiKey)
                .POST(HttpRequest.BodyPublishers.ofString(requestBody))
                .build();
        HttpResponse<String> response = httpClient.send(httpRequest, HttpResponse.BodyHandlers.ofString());
        if (response.statusCode() != 200) {
            log.warn("AI API error {}: {}", response.statusCode(), response.body());
            throw new IllegalStateException("AI API status " + response.statusCode());
        }
        return objectMapper.readTree(response.body())
                .path("choices").path(0).path("message").path("content").asText("");
    }

    private String stripFences(String raw) {
        String json = raw.strip();
        if (json.startsWith("```")) {
            json = json.replaceAll("(?s)^```[a-z]*\\s*", "").replaceAll("```\\s*$", "").strip();
        }
        return json;
    }

    private String extractJsonObject(String raw) {
        String json = stripFences(raw);
        if (json.startsWith("{") && json.endsWith("}")) {
            return json;
        }

        int start = json.indexOf('{');
        int end = json.lastIndexOf('}');
        if (start >= 0 && end > start) {
            return json.substring(start, end + 1).strip();
        }

        throw new IllegalArgumentException("AI response did not contain a JSON object");
    }

    private List<Map<String, Object>> parseOps(JsonNode opsNode) {
        if (!opsNode.isArray() || opsNode.isEmpty()) {
            return List.of();
        }
        return objectMapper.convertValue(
                opsNode,
                objectMapper.getTypeFactory().constructCollectionType(List.class, Map.class)
        );
    }

    private List<Map<String, Object>> prepareOps(JsonNode opsNode) {
        return remapOps(sanitizeOps(parseOps(opsNode)));
    }

    private List<Map<String, Object>> sanitizeOps(List<Map<String, Object>> rawOps) {
        if (rawOps.isEmpty()) {
            return List.of();
        }

        List<Map<String, Object>> safeOps = new ArrayList<>();
        for (Map<String, Object> op : rawOps) {
            if (safeOps.size() >= MAX_AI_OPS) {
                break;
            }

            String opType = stringValue(op.get("opType"));
            String shapeType = stringValue(op.get("shapeType"));
            String shapeId = stringValue(op.get("shapeId"));

            if (!ALLOWED_OP_TYPES.contains(opType) || !ALLOWED_SHAPE_TYPES.contains(shapeType)) {
                continue;
            }
            if (shapeId.isBlank()) {
                if (!"create".equals(opType)) {
                    continue;
                }
                shapeId = "ai-create-" + (safeOps.size() + 1);
            }

            Map<String, Object> copy = new LinkedHashMap<>();
            copy.put("opType", opType);
            copy.put("shapeId", shapeId);
            copy.put("shapeType", shapeType);

            if (!"delete".equals(opType)) {
                Object attrsObj = op.get("attrs");
                Map<String, Object> attrs = new LinkedHashMap<>();
                if (attrsObj instanceof Map<?, ?> rawAttrs) {
                    rawAttrs.forEach((key, value) -> {
                        if (key != null) {
                            attrs.put(String.valueOf(key), value);
                        }
                    });
                }
                copy.put("attrs", attrs);
            }

            safeOps.add(copy);
        }

        return safeOps;
    }

    private String stringValue(Object value) {
        return value == null ? "" : String.valueOf(value).strip();
    }

    // Two-pass shapeId remap: only `create` ops get a fresh real ID; update/delete keep
    // their shapeId (= an existing board shape). Connector references are rewritten too.
    private List<Map<String, Object>> remapOps(List<Map<String, Object>> rawOps) {
        if (rawOps.isEmpty()) {
            return List.of();
        }
        Map<String, String> idMap = new java.util.HashMap<>();
        for (Map<String, Object> op : rawOps) {
            String opType = String.valueOf(op.get("opType"));
            Object aiId = op.get("shapeId");
            if ("create".equals(opType) && aiId instanceof String sid) {
                idMap.put(sid, "ai-" + UUID.randomUUID().toString().substring(0, 8));
            }
        }
        return rawOps.stream().map(op -> {
            Map<String, Object> copy = new java.util.LinkedHashMap<>(op);
            Object sid = copy.get("shapeId");
            if (sid instanceof String s && idMap.containsKey(s)) {
                copy.put("shapeId", idMap.get(s));
            }
            Object attrsObj = copy.get("attrs");
            if (attrsObj instanceof Map<?, ?> rawAttrs) {
                Map<String, Object> attrs = new java.util.LinkedHashMap<>();
                rawAttrs.forEach((k, v) -> attrs.put(String.valueOf(k), v));
                for (String refKey : List.of("fromShapeId", "toShapeId")) {
                    Object ref = attrs.get(refKey);
                    if (ref instanceof String r && idMap.containsKey(r)) {
                        attrs.put(refKey, idMap.get(r));
                    }
                }
                copy.put("attrs", attrs);
            }
            return copy;
        }).toList();
    }
}

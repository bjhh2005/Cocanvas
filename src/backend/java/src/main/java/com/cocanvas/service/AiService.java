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
import java.net.http.HttpTimeoutException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;

@Service
public class AiService {

    private static final Logger log = LoggerFactory.getLogger(AiService.class);
    private static final int MAX_AI_OPS = 120;
    private static final int MAX_ERROR_BODY_CHARS = 600;
    private static final int MAX_MESSAGE_CHARS = 600;
    private static final Set<String> ALLOWED_OP_TYPES = Set.of("create", "update", "delete");
    private static final Set<String> ALLOWED_SHAPE_TYPES = Set.of(
            "rect", "roundedRect", "circle", "diamond", "triangle", "text",
            "sticky", "connector", "pen", "comment", "frame", "card"
    );
    private static final Set<String> STRING_ATTRS = Set.of(
            "fill", "stroke", "text", "textColor", "fontStyle", "title", "body", "assignee"
    );
    private static final Set<String> NUMBER_ATTRS = Set.of(
            "x", "y", "w", "h", "radius", "strokeWidth", "fontSize", "cornerRadius", "zIndex", "votes"
    );
    private static final Set<String> BOOLEAN_ATTRS = Set.of("resolved", "arrowEnd");
    private static final Set<String> ANCHORS = Set.of("top", "right", "bottom", "left", "center");

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

    public record AiSummaryResponse(String markdown) {}

    // ── Single-shot chat (create/update/delete in one model call) ──────────────
    public AiChatResponse chat(String roomId, AiChatRequest request) {
        PreparedRequest prepared = prepareRequest(request);
        if (prepared.prompt().isBlank()) {
            return new AiChatResponse("请输入要让 AI 协助处理的问题。", List.of());
        }
        if (!isConfigured()) {
            return new AiChatResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。", List.of());
        }
        if (!allowRequest(roomId)) {
            return new AiChatResponse("AI 请求过于频繁，请稍等一分钟后再试。", List.of());
        }
        return chatInternal(roomId, prepared);
    }

    public AiChatResponse chat(AiChatRequest request) {
        return chat("unknown", request);
    }

    public AiSummaryResponse summarize(String roomId, AiChatRequest request) {
        PreparedRequest prepared = prepareRequest(request);
        if (prepared.prompt().isBlank()) {
            return new AiSummaryResponse("请输入要让 AI 协助总结的问题。");
        }
        if (!isConfigured()) {
            return new AiSummaryResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。");
        }
        if (!allowRequest(roomId)) {
            return new AiSummaryResponse("AI 请求过于频繁，请稍等一分钟后再试。");
        }

        try {
            String userContent = "【当前白板信息】\n" + prepared.boardContext()
                    + "\n\n【总结要求】\n" + prepared.prompt();
            String markdown = stripFences(callModel(SUMMARY_PROMPT, userContent, 0.2)).strip();
            return new AiSummaryResponse(markdown.isBlank() ? "AI 未返回会议总结。" : markdown);
        } catch (HttpTimeoutException e) {
            log.warn("AI summarize timeout for room {}", roomId);
            return new AiSummaryResponse("AI 总结请求超时，请稍后重试或缩短白板内容。");
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("AI summarize interrupted for room {}", roomId);
            return new AiSummaryResponse("AI 总结请求已中断，请稍后重试。");
        } catch (Exception e) {
            log.error("AI summarize error", e);
            return new AiSummaryResponse("AI 总结暂时不可用，请稍后重试。");
        }
    }

    public AiSummaryResponse summarize(AiChatRequest request) {
        return summarize("unknown", request);
    }

    // ── LangChain-style multi-agent orchestration ──────────────────────────────
    // 1) Planner 主 AI：决定划分多少区域、各区域主题与互不重叠的边界框
    // 2) 多个 Sub AI：并行在各自边界框内生成内容
    // 3) Merge AI：根据各区域产出，补充跨区域连接线与总标题
    public AiChatResponse orchestrate(String roomId, AiChatRequest request) {
        PreparedRequest prepared = prepareRequest(request);
        if (prepared.prompt().isBlank()) {
            return new AiChatResponse("请输入要让 AI 协助处理的问题。", List.of());
        }
        if (!isConfigured()) {
            return new AiChatResponse("AI 功能未配置，请设置 AI_API_KEY 环境变量。", List.of());
        }
        if (!allowRequest(roomId)) {
            return new AiChatResponse("AI 请求过于频繁，请稍等一分钟后再试。", List.of());
        }

        try {
            // ── Step 1: Planner ──
            String plannerUser = "【当前白板信息】\n" + prepared.boardContext()
                    + "\n\n【用户请求】\n" + prepared.prompt();
            JsonNode plan = objectMapper.readTree(extractJsonObject(callModel(PLANNER_PROMPT, plannerUser, 0.2)));
            String strategy = plan.path("strategy").asText("direct");
            JsonNode regions = plan.path("regions");

            // 简单/修改类请求 → 退回单次调用
            if (!"multi".equals(strategy) || !regions.isArray() || regions.size() < 2) {
                return chatInternal(roomId, prepared);
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
                futures.add(CompletableFuture.supplyAsync(() -> generateRegion(region, prepared.prompt())));
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
            String mergeUser = "用户原始目标：" + prepared.prompt()
                    + "\n\n各子区域已生成以下节点（id 可用于连接线）：\n" + nodeSummary;
            String mergeMsg = "已通过多智能体协作完成：规划 " + regionList.size() + " 个区域并合并。";
            try {
                JsonNode merge = objectMapper.readTree(extractJsonObject(callModel(MERGE_PROMPT, mergeUser, 0.2)));
                mergeMsg = trimToLimit(merge.path("message").asText(mergeMsg), MAX_MESSAGE_CHARS);
                allOps.addAll(prepareOps(merge.path("ops")));
            } catch (Exception e) {
                log.warn("Merge step failed, returning region ops only: {}", e.getMessage());
            }

            return new AiChatResponse(mergeMsg + safeSuffix(allOps), allOps);
        } catch (HttpTimeoutException e) {
            log.warn("AI orchestration timeout for room {}", roomId);
            return new AiChatResponse("AI 请求超时，请稍后重试或缩短输入内容。", List.of());
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            log.warn("AI orchestration interrupted for room {}", roomId);
            return new AiChatResponse("AI 请求已中断，请稍后重试。", List.of());
        } catch (Exception e) {
            log.error("AI orchestrate error", e);
            return chatInternal(roomId, prepared);
        }
    }

    public AiChatResponse orchestrate(AiChatRequest request) {
        return orchestrate("unknown", request);
    }

    private AiChatResponse chatInternal(String roomId, PreparedRequest prepared) {
        try {
            String userContent = "【当前白板信息】\n" + prepared.boardContext()
                    + "\n\n【用户请求】\n" + prepared.prompt();
            String content = callModel(SYSTEM_PROMPT, userContent, 0.35);
            return parseModelContent(content);
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
            return parseModelContent(rawText);
        } catch (Exception e) {
            log.warn("AI response parse failed: {}", e.getMessage());
            return new AiChatResponse("AI 返回格式不稳定，已安全忽略本次内容，请重试。", List.of());
        }
    }

    private AiChatResponse parseModelContent(String content) {
        try {
            JsonNode parsed = objectMapper.readTree(extractJsonObject(content));
            String message = trimToLimit(parsed.path("message").asText("已生成内容。"), MAX_MESSAGE_CHARS);
            List<Map<String, Object>> ops = prepareOps(parsed.path("ops"));
            return new AiChatResponse(message + safeSuffix(ops), ops);
        } catch (Exception e) {
            log.warn("AI response parse failed: {}", e.getMessage());
            return new AiChatResponse("AI 返回格式不稳定，已安全忽略本次内容，请重试。", List.of());
        }
    }

    private List<Map<String, Object>> generateRegion(JsonNode region, String userGoal) {
        try {
            int rx = clamp(region.path("x").asInt(200), -100_000, 100_000);
            int ry = clamp(region.path("y").asInt(120), -100_000, 100_000);
            int rw = clamp(region.path("width").asInt(900), 240, 2_000);
            int rh = clamp(region.path("height").asInt(640), 180, 2_000);
            String title = trimToLimit(region.path("title").asText("区域"), 120);
            String theme = trimToLimit(region.path("theme").asText(""), 800);

            String sub = "用户整体目标：" + userGoal
                    + "\n\n你只负责生成【" + title + "】这一个区域的内容。"
                    + "\n区域主题/要求：" + theme
                    + "\n区域边界框：x ∈ [" + rx + ", " + (rx + rw) + "]，y ∈ [" + ry + ", " + (ry + rh) + "]。"
                    + "\n所有图形必须落在此边界框内，从 x=" + (rx + 24) + ", y=" + (ry + 56) + " 开始排布，互不重叠。"
                    + "\n在区域顶部用一个 text 标题标注【" + title + "】（y=" + ry + "）。";
            JsonNode parsed = objectMapper.readTree(extractJsonObject(callModel(SYSTEM_PROMPT, sub, 0.35)));
            return prepareOps(parsed.path("ops"));
        } catch (Exception e) {
            log.warn("Region generation failed: {}", e.getMessage());
            return List.of();
        }
    }

    // ── Low-level model call (OpenAI-compatible, works for DeepSeek) ────────────
    private String callModel(String systemPrompt, String userContent, double temperature) throws Exception {
        Map<String, Object> requestPayload = new LinkedHashMap<>();
        requestPayload.put("model", model);
        requestPayload.put("max_tokens", clamp(maxTokens, 256, 4096));
        requestPayload.put("temperature", Math.max(0, Math.min(1, temperature)));
        requestPayload.put("messages", List.of(
                Map.of("role", "system", "content", systemPrompt),
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
            throw new IllegalStateException("AI API status " + response.statusCode());
        }
        return objectMapper.readTree(response.body())
                .path("choices").path(0).path("message").path("content").asText("");
    }

    private List<Map<String, Object>> prepareOps(JsonNode opsNode) {
        return remapOps(sanitizeOps(opsNode));
    }

    private List<Map<String, Object>> sanitizeOps(JsonNode opsNode) {
        if (!opsNode.isArray() || opsNode.isEmpty()) {
            return List.of();
        }

        List<Map<String, Object>> safeOps = new ArrayList<>();
        for (JsonNode opNode : opsNode) {
            if (safeOps.size() >= opLimit()) {
                break;
            }

            Map<String, Object> op = sanitizeOp(opNode, safeOps.size());
            if (!op.isEmpty()) {
                safeOps.add(op);
            }
        }

        return safeOps;
    }

    private Map<String, Object> sanitizeOp(JsonNode opNode, int index) {
        if (!opNode.isObject()) {
            return Map.of();
        }

        String opType = opNode.path("opType").asText("");
        String shapeType = opNode.path("shapeType").asText("");
        String shapeId = opNode.path("shapeId").asText("");
        if (!ALLOWED_OP_TYPES.contains(opType) || !ALLOWED_SHAPE_TYPES.contains(shapeType)) {
            return Map.of();
        }
        if (shapeId.isBlank()) {
            if (!"create".equals(opType)) {
                return Map.of();
            }
            shapeId = "ai-create-" + (index + 1);
        }

        Map<String, Object> op = new LinkedHashMap<>();
        op.put("opType", opType);
        op.put("shapeId", trimToLimit(shapeId, 120));
        op.put("shapeType", shapeType);

        if (!"delete".equals(opType)) {
            Map<String, Object> attrs = sanitizeAttrs(opNode.path("attrs"), shapeType, index, "create".equals(opType));
            if (!"create".equals(opType) && attrs.isEmpty()) {
                return Map.of();
            }
            op.put("attrs", attrs);
        }
        return op;
    }

    private Map<String, Object> sanitizeAttrs(JsonNode attrsNode, String shapeType, int index, boolean applyDefaults) {
        Map<String, Object> attrs = new LinkedHashMap<>();
        if (attrsNode.isObject()) {
            attrsNode.fields().forEachRemaining(entry -> {
                String key = entry.getKey();
                JsonNode value = entry.getValue();
                if (STRING_ATTRS.contains(key) && value.isTextual()) {
                    attrs.put(key, trimToLimit(value.asText(), textLimit(key)));
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
                } else if (("fromAnchor".equals(key) || "toAnchor".equals(key)) && value.isTextual()) {
                    attrs.put(key, sanitizeEnum(value.asText(), ANCHORS, "center"));
                } else if (("fromShapeId".equals(key) || "toShapeId".equals(key)) && "connector".equals(shapeType) && value.isTextual()) {
                    attrs.put(key, trimToLimit(value.asText(), 120));
                } else if ("points".equals(key) && "pen".equals(shapeType) && value.isArray()) {
                    attrs.put(key, sanitizePointArray(value));
                }
            });
        }

        if (applyDefaults) {
            attrs.putIfAbsent("x", 220 + index * 36);
            attrs.putIfAbsent("y", 180 + index * 36);
            applyShapeDefaults(attrs, shapeType);
        }
        return attrs;
    }

    private void applyShapeDefaults(Map<String, Object> attrs, String shapeType) {
        if ("card".equals(shapeType)) {
            attrs.putIfAbsent("w", 260);
            attrs.putIfAbsent("h", 180);
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
        } else if ("connector".equals(shapeType)) {
            attrs.putIfAbsent("fill", "transparent");
            attrs.putIfAbsent("stroke", "#475569");
            attrs.putIfAbsent("strokeWidth", 2);
            attrs.putIfAbsent("arrowEnd", true);
            attrs.putIfAbsent("fromAnchor", "right");
            attrs.putIfAbsent("toAnchor", "left");
            attrs.putIfAbsent("zIndex", -2);
        } else if ("circle".equals(shapeType)) {
            attrs.putIfAbsent("radius", 50);
            attrs.putIfAbsent("fill", "#dcfce7");
            attrs.putIfAbsent("stroke", "#16a34a");
            attrs.putIfAbsent("strokeWidth", 2);
            attrs.putIfAbsent("textColor", "#14532d");
            attrs.putIfAbsent("fontSize", 14);
        } else if ("diamond".equals(shapeType) || "triangle".equals(shapeType)) {
            attrs.putIfAbsent("w", 160);
            attrs.putIfAbsent("h", 120);
            attrs.putIfAbsent("fill", "#fef9c3");
            attrs.putIfAbsent("stroke", "#ca8a04");
            attrs.putIfAbsent("strokeWidth", 2);
            attrs.putIfAbsent("textColor", "#713f12");
            attrs.putIfAbsent("fontSize", 15);
        } else if ("comment".equals(shapeType)) {
            attrs.putIfAbsent("w", 220);
            attrs.putIfAbsent("h", 86);
            attrs.putIfAbsent("text", "AI 批注");
            attrs.putIfAbsent("fill", "#ffffff");
            attrs.putIfAbsent("stroke", "#e5e7eb");
            attrs.putIfAbsent("strokeWidth", 1);
            attrs.putIfAbsent("textColor", "#111827");
            attrs.putIfAbsent("fontSize", 14);
            attrs.putIfAbsent("cornerRadius", 8);
            attrs.putIfAbsent("resolved", false);
        } else if ("pen".equals(shapeType)) {
            attrs.putIfAbsent("points", List.of());
            attrs.putIfAbsent("fill", "transparent");
            attrs.putIfAbsent("stroke", "#111827");
            attrs.putIfAbsent("strokeWidth", 3);
        } else {
            attrs.putIfAbsent("w", "roundedRect".equals(shapeType) ? 160 : 140);
            attrs.putIfAbsent("h", "roundedRect".equals(shapeType) ? 90 : 80);
            attrs.putIfAbsent("fill", "#dbeafe");
            attrs.putIfAbsent("stroke", "#2563eb");
            attrs.putIfAbsent("strokeWidth", 2);
            attrs.putIfAbsent("textColor", "#1e3a8a");
            attrs.putIfAbsent("fontSize", 16);
            attrs.putIfAbsent("cornerRadius", "roundedRect".equals(shapeType) ? 18 : 0);
        }
    }

    // Two-pass shapeId remap: only `create` ops get a fresh real ID; update/delete keep
    // their shapeId (= an existing board shape). Connector references are rewritten too.
    private List<Map<String, Object>> remapOps(List<Map<String, Object>> rawOps) {
        if (rawOps.isEmpty()) {
            return List.of();
        }
        Map<String, String> idMap = new LinkedHashMap<>();
        for (Map<String, Object> op : rawOps) {
            Object aiId = op.get("shapeId");
            if ("create".equals(op.get("opType")) && aiId instanceof String sid) {
                idMap.put(sid, "ai-" + UUID.randomUUID().toString().substring(0, 8));
            }
        }
        return rawOps.stream().map(op -> {
            Map<String, Object> copy = new LinkedHashMap<>(op);
            Object sid = copy.get("shapeId");
            if (sid instanceof String s && idMap.containsKey(s)) {
                copy.put("shapeId", idMap.get(s));
            }
            Object attrsObj = copy.get("attrs");
            if (attrsObj instanceof Map<?, ?> rawAttrs) {
                Map<String, Object> attrs = new LinkedHashMap<>();
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

    private PreparedRequest prepareRequest(AiChatRequest request) {
        String prompt = trimToLimit(request == null ? "" : request.prompt(), maxPromptChars);
        String boardContext = trimToLimit(request == null ? "" : request.boardContext(), maxContextChars);
        return new PreparedRequest(prompt, boardContext);
    }

    private boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
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

    private String stripFences(String raw) {
        String json = raw == null ? "" : raw.strip();
        if (json.startsWith("```")) {
            json = json.replaceAll("(?s)^```[a-zA-Z]*\\s*", "").replaceAll("```\\s*$", "").strip();
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

    private List<Long> sanitizePointArray(JsonNode value) {
        List<Long> result = new ArrayList<>();
        for (JsonNode item : value) {
            if (result.size() >= 256) {
                break;
            }
            if (item.isNumber()) {
                result.add(Math.round(Math.max(-100_000, Math.min(100_000, item.asDouble()))));
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

    private int opLimit() {
        return clamp(maxOps, 1, MAX_AI_OPS);
    }

    private int textLimit(String key) {
        if ("body".equals(key)) {
            return 1_200;
        }
        if ("fill".equals(key) || "stroke".equals(key) || "textColor".equals(key) || "fontStyle".equals(key)) {
            return 80;
        }
        if ("assignee".equals(key)) {
            return 80;
        }
        return 500;
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

    private String safeSuffix(List<Map<String, Object>> ops) {
        return ops.isEmpty() ? "" : "（已安全校验 " + ops.size() + " 个图形操作）";
    }

    private record PreparedRequest(String prompt, String boardContext) {}

    private record RateLimitBucket(long windowStartMs, int count) {}
}

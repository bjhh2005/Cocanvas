# 给下一个 AI 的交接说明

## 当前进度

按 [docs/04_开发计划.md](../04_开发计划.md) 推进，已到 **Step 21**：

- ✅ Step 1-19：项目骨架 / Docker / Nginx / 前后端联通 / 协议 DTO / 连接管理 / 光标同步（详见 [step19.md](step19.md)）
- ✅ Step 20：协议扩展——`op` 消息（inbound + outbound 字段定义已在 `src/protocol/messages.md`，本次无改动，字段定义在上一版本已预置）
- ✅ Step 21：后端 `OpMessage` / `OpBroadcastMessage` 处理——收到 `op` 消息直接广播给房间其他人，**纯转发，无校验，无持久化**

第一阶段验证（两标签互见光标）依然有效，Step 21 验证方式见下文。

---

## 新增 / 变更文件（Step 20-21）

### 后端

| 文件 | 变更说明 |
|---|---|
| [protocol/Op.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/Op.java) | **新增**，放在父包 `com.cocanvas.protocol`（共享类型，避免 outbound→inbound 循环依赖）；字段：`opType` / `shapeId` / `shapeType` / `attrs`（`JsonNode`，原样透传，不做结构校验） |
| [protocol/inbound/OpMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/OpMessage.java) | **新增**，实现 `InboundMessage`；字段：`msgId` / `roomId` / `userId` / `hlc`（今天忽略）/ `op` |
| [protocol/inbound/InboundMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/InboundMessage.java) | 加入 `OpMessage` 到 `@JsonSubTypes` + `sealed permits` |
| [protocol/outbound/OpBroadcastMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/OpBroadcastMessage.java) | **新增**；字段：`fromUserId` / `hlc` / `op`；`type()` 方法返回 `"op"` |
| [ws/CollabWebSocketHandler.java](../../src/backend/java/src/main/java/com/cocanvas/ws/CollabWebSocketHandler.java) | 加入 `handleOp` 分支：检查 `not_joined`，构造 `OpBroadcastMessage(userId, hlc, op)` 广播给房间其他人 |

### 协议文档

`src/protocol/messages.md` 的 §1.3 和 §2.5 已在上一轮预置了 `op` 消息定义，本次 **无改动**。

---

## 架构说明

### `Op` 为什么放父包而非 `inbound`

`OpBroadcastMessage`（`outbound` 包）需要持有 `Op`。如果 `Op` 在 `inbound`，`outbound` 就会依赖 `inbound`，形成不对称耦合。放在 `com.cocanvas.protocol` 父包作为共享类型，两个子包都可以引用。

### `attrs` 用 `JsonNode` 而非具体 DTO

当前只支持 `rect`，`circle` / `text` 后续再加。用 `JsonNode` 接收、原样序列化，避免现在就定义三个 attrs 类型的 union 处理逻辑，后续加字段不需要改后端。

---

## 验证 Step 21

### DevTools 手测

1. 起服务（必须 `--scale backend=1`）：
   ```bash
   docker compose up -d --scale backend=1
   ```

2. 打开两个标签（A、B），都进同一房间，等连接指示器变绿。

3. **标签 A** 的 DevTools → Network → WS → 选 `/ws/collab` 连接 → 点 `Messages` 标签。

4. 在 A 的 Console 发一条 op：
   ```js
   // 先拿到 wsClient（前端模块单例）
   // 方法一：直接在 Console 里构造 WebSocket 发（更简单）
   // 假设当前 WS 已在 A 的 wsClient 里；用以下方式也可以直接在 Messages 里手填
   ```
   或直接在 A 的 WS Messages 面板用"Send"按钮粘贴：
   ```json
   {
     "type": "op",
     "msgId": "00000000-0000-0000-0000-000000000001",
     "roomId": "替换成当前 roomId",
     "userId": "替换成 A 的 userId",
     "op": {
       "opType": "create",
       "shapeId": "s-test-0001",
       "shapeType": "rect",
       "attrs": { "x": 100, "y": 120, "w": 100, "h": 80, "fill": "#3498db" }
     }
   }
   ```

5. **预期**：
   - A 的 WS Messages 面板：**不**收到任何回包（发送者被排除在广播之外）
   - B 的 WS Messages 面板：收到：
     ```json
     {
       "type": "op",
       "fromUserId": "替换成 A 的 userId",
       "hlc": null,
       "op": { "opType": "create", "shapeId": "s-test-0001", "shapeType": "rect", "attrs": {...} }
     }
     ```

6. 也可以测 `not_joined` 错误路径：新开一个原生 WS 连接，**不发 join 直接发 op**，应收到：
   ```json
   { "type": "error", "code": "not_joined", "message": "send join before op", "refMsgId": "..." }
   ```

---

## 下一步

**Step 22+**：Konva 画布、矩形绘制。  
先确认用户想从哪个 Step 开始，不要擅自往下做。

参考文件：
- [docs/07_前端Demo描述.md](../07_前端Demo描述.md) — Toolbar、Canvas 区域 UI 设计
- [src/protocol/messages.md](../../src/protocol/messages.md) — `rect` 的 `attrs` 字段定义在 §三

---

## 必须遵守的约定（完整版见 step19.md，以下补充本阶段新增）

> 以下继承自 step19.md，无变更：
> 1. 后端 Controller 不带 `/api/` 前缀（Nginx 加）
> 2. 新 WS endpoint 不用动 Nginx（`/ws/` 已通配）
> 3. 前端 WS 单例 + staleness 守卫
> 4. Zustand selector 用 `useShallow` 或拆成标量
> 5. 多标签调试用 `sessionStorage`
> 6. 改了 lockfile 在容器里装依赖，不在宿主机装 pnpm/node
> 7. 选原生 `TextWebSocketHandler` 不选 STOMP
> 8. 不提前实现 Redis/MySQL/CRDT/一致性哈希
> 9. 改 nginx.conf 后 `docker compose restart nginx`
> 10. 出站 record 的 `type` 字段用额外方法，不放构造参数

> 本阶段新增：
> 11. **共享 DTO 放父包**——`inbound` / `outbound` 双向依赖的类型放 `com.cocanvas.protocol`，不要放任意一个子包
> 12. **`attrs` 不要过早固化为具体 DTO**——`JsonNode` 透传直到有充分理由换成 union 类型

---

## 当前已知限制

- **后端必须缩到 1 副本**：无 Redis Pub/Sub，多副本导致同房间客户端落不同实例、互相不可见。
  ```bash
  docker compose up -d --scale backend=1
  ```
- **`hlc` 字段今天全程忽略**：`OpMessage.hlc` 接收到什么就透传到 `OpBroadcastMessage.hlc`，不做任何验证或排序，对应 `messages.md` 里的 🟡 Step 30 标记。
- **无持久化**：服务重启后房间状态清空，前端刷新页面画布为空（Step 41 Snapshot 引入后解决）。
- **无冲突处理**：两人同时移动同一图形会出现位置跳变，是 Step 26 引出 CRDT 的契机。

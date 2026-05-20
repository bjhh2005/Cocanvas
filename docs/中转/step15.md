# 给下一个 AI 的交接说明

## 当前进度

按 [docs/04_开发计划.md](../04_开发计划.md) 推进，已完成到 **Step 15**：

- ✅ Step 1-6：项目骨架、Docker Compose、Nginx 反向代理、前后端联通（`/api/health` 走通）
- ✅ Step 7-9：后端 WebSocket Echo Handler（`/ws/echo`），DevTools 手测回显
- ✅ Step 12：`RoomController` 提供 `POST /api/rooms`、`GET /api/rooms/{roomId}`
- ✅ Step 13：`RoomSessionRegistry` + `CollabWebSocketHandler` 骨架，`/ws/collab` 端点可连
- ✅ Step 14：协议 DTO 层（inbound sealed interface + outbound records）+ Jackson 多态反序列化单元测试通过
- ✅ Step 15：`CollabWebSocketHandler` 消息流完整串通，join/cursor/disconnect 全部处理

下一步是 **Step 16**：前端接入路由和 connectionStore。先确认用户想推进哪一步，不要擅自往下做。

## 必读文件（按优先级）

1. **[docs/04_开发计划.md](../04_开发计划.md)** —— 整个阶段的 step-by-step 推进顺序，每步都有"验证标准"
2. **[src/protocol/messages.md](../../src/protocol/messages.md)** —— 所有消息字段的权威定义，DTO 字段直接对这里
3. **[docs/03_项目结构.md](../03_项目结构.md)** —— 后端包划分、前端目录约定、关键架构决策
4. **[docs/08_网络结构文档.md](../08_网络结构文档.md)** —— Nginx 路由表 / 路径剥离 / Docker vs Vite 直连两种模式
5. **[docs/05_接口文档.md](../05_接口文档.md)** —— REST + WS 协议契约

## 当前代码关键文件

后端协议层（Step 14 新增）：

| 文件 | 说明 |
|---|---|
| [protocol/inbound/InboundMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/InboundMessage.java) | sealed interface，带 `@JsonTypeInfo`/`@JsonSubTypes`，Jackson 用 `"type"` 字段分发 |
| [protocol/inbound/JoinMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/JoinMessage.java) | record，字段：msgId / roomId / userId / displayName / color |
| [protocol/inbound/CursorMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/CursorMessage.java) | record，字段：msgId / roomId / userId / x / y |
| [protocol/outbound/UserInfo.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/UserInfo.java) | record，三字段：userId / displayName / color，被 JoinedMessage 嵌套引用 |
| [protocol/outbound/JoinedMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/JoinedMessage.java) | `type:"joined"`，含 `you` 和 `peers[]` |
| [protocol/outbound/PeerJoinedMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/PeerJoinedMessage.java) | `type:"peer-joined"` |
| [protocol/outbound/PeerLeftMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/PeerLeftMessage.java) | `type:"peer-left"` |
| [protocol/outbound/CursorBroadcastMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/CursorBroadcastMessage.java) | `type:"cursor"`，转发给其他人（去掉 msgId/roomId） |
| [protocol/outbound/ErrorMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/ErrorMessage.java) | `type:"error"`，含 code / message / refMsgId（nullable） |

后端 WS 层（Step 15 修改）：

| 文件 | 说明 |
|---|---|
| [ws/CollabWebSocketHandler.java](../../src/backend/java/src/main/java/com/cocanvas/ws/CollabWebSocketHandler.java) | 消息分发入口，注入 registry + objectMapper |
| [ws/RoomSessionRegistry.java](../../src/backend/java/src/main/java/com/cocanvas/ws/RoomSessionRegistry.java) | 新增 `getSessions(roomId)` 方法，用于 join 时构建 peers 快照 |

测试：

| 文件 | 说明 |
|---|---|
| [InboundMessageDeserializationTest.java](../../src/backend/java/src/test/java/com/cocanvas/protocol/InboundMessageDeserializationTest.java) | 单元测试：join + cursor 两条 JSON → 正确反序列化，✅ 通过 |

前端（未动）：

- [src/frontend/app/src/App.tsx](../../src/frontend/app/src/App.tsx) —— 当前仍是 Echo Demo 页面，Step 16 开始改造

基础设施（未动）：

- [src/nginx/nginx.conf](../../src/nginx/nginx.conf)
- [docker-compose.yml](../../docker-compose.yml)

## Step 14-15 实现要点

### 出站消息的 `type` 字段

出站 record 不在多态继承体系里，`type` 用**额外方法**注入序列化：

```java
public record PeerJoinedMessage(String userId, String displayName, String color) {
    @JsonProperty("type")
    public String type() { return "peer-joined"; }  // 带连字符，无法做字段名
}
```

### session.getAttributes() 存身份

`JoinMessage` 处理时把 roomId / userId / displayName / color 写入：

```java
session.getAttributes().put("roomId", join.roomId());
// ...
```

`afterConnectionClosed` 从这里读，不需要额外的反向查表结构。

### join 时 peers 快照的时序

**先**用 `registry.getSessions()` 拿当前房间成员（不含自己）**再** `registry.join()` 注册自己——否则 peers 列表会包含自己。

### broadcastInRoom 的 except 参数

- 广播 `peer-joined`：`except = session`（新人自己不收）
- 广播 `cursor`：`except = session`（发送者自己不收）
- 广播 `peer-left`：`except = null`（发送者已离开，房间剩余全员都应收到）

## 验证当前状态

```bash
# 单元测试
cd src/backend/java
./gradlew test --tests "com.cocanvas.protocol.InboundMessageDeserializationTest"
# BUILD SUCCESSFUL

# 手动端到端（两个 DevTools 标签页）
# 标签 A：
const ws = new WebSocket("ws://localhost:8080/ws/collab");
ws.onmessage = e => console.log("A:", e.data);
ws.send(JSON.stringify({type:"join",msgId:crypto.randomUUID(),roomId:"r1",userId:"u-A",displayName:"Alice",color:"#e74c3c"}));
# → A 收到 joined，peers:[]

# 标签 B：
const ws2 = new WebSocket("ws://localhost:8080/ws/collab");
ws2.onmessage = e => console.log("B:", e.data);
ws2.send(JSON.stringify({type:"join",msgId:crypto.randomUUID(),roomId:"r1",userId:"u-B",displayName:"Bob",color:"#3498db"}));
# → B 收到 joined，peers 含 Alice
# → A 收到 peer-joined，userId:"u-B"

# A 发 cursor：
ws.send(JSON.stringify({type:"cursor",msgId:crypto.randomUUID(),roomId:"r1",userId:"u-A",x:100,y:200}));
# → B 收到 {"type":"cursor","userId":"u-A","x":100.0,"y":200.0}

# 关闭标签 A：
# → B 收到 {"type":"peer-left","userId":"u-A"}
```

## 必须遵守的约定（已踩过坑）

1. **后端 Controller 不要带 `/api/` 前缀**。`/api/` 是 Nginx 加的，带了会变成 `/api/api/rooms`。
2. **新增 WS endpoint 不用动 Nginx**。`/ws/` 已通配，只在 `WebSocketConfig` 里注册即可。
3. **前端 WebSocket 不要放进 React state**。用模块单例管理，否则 React 重渲染和 WS 生命周期会冲突。
4. **WebSocket 选原生 `TextWebSocketHandler` 不选 STOMP**。STOMP 会和后续一致性哈希、CRDT 排序冲突。
5. **改了 nginx.conf 要 `docker compose restart nginx`**，挂载是 `:ro` 不会自动 reload。
6. **当前阶段 Redis / MySQL / CRDT / 一致性哈希全部不做**，看到开发计划里这些步骤之前不要提前实现。
7. **出站 record 的 `type` 字段用额外方法不用构造参数**，否则 Jackson 序列化时字段顺序不稳定、构造时还要手传字符串常量。

## 用户偏好（已观察到的）

- 中文沟通，回复**简洁、不要过度总结**
- 改动后**主动跑验证**（单元测试 / curl / DevTools），不要只说"应该没问题"
- 文档风格：表格 + 文件路径链接 + "易踩的坑"小节
- 代码：**不写无用注释**、不留 TODO 占位、Java 用 `record` 当 DTO、不引入超出当前阶段所需的抽象

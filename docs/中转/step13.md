# 给下一个 AI 的交接说明

## 当前进度

按 [docs/04_开发计划.md](../04_开发计划.md) 推进，已完成到 **Step 13**：

- ✅ Step 1-6：项目骨架、Docker Compose、Nginx 反向代理、前后端联通（`/api/health` 走通）
- ✅ Step 7-8：后端 WebSocket Echo Handler（`/ws/echo`），前端 Demo 页面已能连接并回显
- ✅ Step 12：`RoomController` 提供 `POST /api/rooms`、`GET /api/rooms/{roomId}`
- ✅ Step 13：`RoomSessionRegistry` + `CollabWebSocketHandler` 骨架，`/ws/collab` 端点可连

下一步要做的是开发计划里 **Step 14 起的内容**（先确认用户想推进哪一阶段，不要擅自往下做）。

## 必读文件（按优先级）

1. **[docs/04_开发计划.md](../04_开发计划.md)** —— 整个阶段一的 step-by-step 推进顺序，每步都有"验证标准"，照做就行
2. **[docs/03_项目结构.md](../03_项目结构.md)** —— 后端包划分、前端目录约定、关键架构决策（**原生 WebSocket 而非 STOMP**、不要把 WS 实例放 React state 等）
3. **[docs/08_网络结构文档.md](../08_网络结构文档.md)** —— Nginx 路由表 / 路径剥离机制 / 两种运行模式（Docker vs Vite 直连）
4. **[docs/01_设计文档.md](../01_设计文档.md)** + **[docs/02_需求文档.md](../02_需求文档.md)** —— 架构背景，了解为什么这么选型
5. **[docs/05_接口文档.md](../05_接口文档.md)** —— REST + WS 协议契约

## 当前代码关键文件

后端：
- [src/backend/java/src/main/java/com/cocanvas/config/WebSocketConfig.java](../../src/backend/java/src/main/java/com/cocanvas/config/WebSocketConfig.java) —— 同时注册 `/ws/echo` 和 `/ws/collab`
- [src/backend/java/src/main/java/com/cocanvas/config/CorsConfig.java](../../src/backend/java/src/main/java/com/cocanvas/config/CorsConfig.java) —— CORS 白名单（注意 WS 跨域要在 `WebSocketConfig` 单独配，不会自动继承）
- [src/backend/java/src/main/java/com/cocanvas/ws/RoomSessionRegistry.java](../../src/backend/java/src/main/java/com/cocanvas/ws/RoomSessionRegistry.java) —— 房间→会话映射，提供 `join` / `leave` / `broadcastInRoom`，**CollabWebSocketHandler 尚未调用它**
- [src/backend/java/src/main/java/com/cocanvas/ws/CollabWebSocketHandler.java](../../src/backend/java/src/main/java/com/cocanvas/ws/CollabWebSocketHandler.java) —— 三个回调只打日志，是空壳；下一步在这里解析 roomId 并调 registry
- [src/backend/java/src/main/java/com/cocanvas/ws/EchoWebSocketHandler.java](../../src/backend/java/src/main/java/com/cocanvas/ws/EchoWebSocketHandler.java) —— 原 Echo 端点，保留不动
- [src/backend/java/src/main/java/com/cocanvas/controller/RoomController.java](../../src/backend/java/src/main/java/com/cocanvas/controller/RoomController.java) —— `roomId` 是 UUID 截前 8 位，**没有真存储**，GET 永远返回 `exists: true`

前端：
- [src/frontend/app/src/App.tsx](../../src/frontend/app/src/App.tsx) —— 当前是 Echo Demo 页面，**`WS_URL` 只适配 Docker 模式**（顶部注释有 Vite 模式改法）
- [src/frontend/app/src/network/api.ts](../../src/frontend/app/src/network/api.ts) —— HTTP 调用一律走 `/api/...` 相对路径

基础设施：
- [src/nginx/nginx.conf](../../src/nginx/nginx.conf) —— 三条 location：`/`（前端 + HMR）、`/api/`（剥前缀转后端）、`/ws/`（保留路径，长超时）
- [docker-compose.yml](../../docker-compose.yml) —— `backend.deploy.replicas: 2`，Nginx 自动 round-robin

## Step 13 新增内容说明

### RoomSessionRegistry

```
rooms: ConcurrentHashMap<String, Set<WebSocketSession>>
                              ↑ roomId   ↑ ConcurrentHashMap.newKeySet()
```

- `join(roomId, session)` — `computeIfAbsent` 懒建房间 Set，加入 session
- `leave(roomId, session)` — 移除 session；Set 变空则删掉 roomId，防内存泄漏
- `broadcastInRoom(roomId, message, exceptSession)` — 遍历 Set，跳过发送者和已关闭连接，IO 异常只 warn 不抛

用 `ConcurrentHashMap` 是因为 WebSocket 回调并发触发，需要线程安全。

### CollabWebSocketHandler（目前是空壳）

三个回调只打 `[collab]` 前缀日志，**未接入 registry**。下一步实现时需要：
1. 从 URL query param 或首条消息里解析出 `roomId`
2. `afterConnectionEstablished` → `registry.join(roomId, session)`
3. `handleTextMessage` → `registry.broadcastInRoom(roomId, payload, session)`
4. `afterConnectionClosed` → `registry.leave(roomId, session)`

## 必须遵守的约定（已踩过坑）

1. **后端 Controller 不要带 `/api/` 前缀**。`/api/` 是 Nginx 加的，后端写 `/rooms` 即可。带前缀会变成 `/api/api/rooms`。
2. **新增 WS endpoint 不用动 Nginx**。`/ws/` 已通配，只在 `WebSocketConfig.addHandler(..., "/ws/xxx")` 注册即可。
3. **前端 WebSocket 不要放进 React state**。用模块单例 / Zustand 之外的管理器，组件用事件订阅。React 重渲染和 WS 生命周期搅一起会出诡异 bug。
4. **WebSocket 选原生（`TextWebSocketHandler`）不选 STOMP**。STOMP 自带的房间路由会和后续的一致性哈希、CRDT 排序冲突。
5. **改了 nginx.conf 要 `docker compose restart nginx`**，挂载是 `:ro` 不会自动 reload。
6. **当前阶段 Redis / MySQL / CRDT / 一致性哈希全部不做**，`pubsub/`、`crdt/`、`routing/`、`persistence/` 是占位空包。看到开发计划里这些步骤之前不要提前实现。

## 验证当前状态

```bash
# 起 Docker
docker compose up -d

# REST 端点
curl http://localhost/api/health              # {"status":"ok"}
curl -X POST http://localhost/api/rooms       # {"roomId":"...","wsUrl":"..."}
curl http://localhost/api/rooms/test123       # {"roomId":"test123","exists":true,...}

# 验证 /ws/collab 端点（浏览器 Console）
const ws = new WebSocket("ws://localhost/ws/collab");
ws.onopen = () => console.log("connected");
# 后端日志应出现：[collab] connection established: <session-id>

# 或用 wscat
npx wscat -c ws://localhost/ws/collab
```

## 用户偏好（已观察到的）

- 中文沟通，回复**简洁、不要过度总结**
- 改动后**主动跑端到端验证**（curl / 浏览器 / WS 握手脚本），不要只说"应该没问题"
- 文档风格：表格 + 配置文件路径链接 + "易踩的坑"小节，参考 [docs/08_网络结构文档.md](../08_网络结构文档.md)
- 代码：**不写无用注释**、不留 TODO 占位、Java 用 `record` 当 DTO、不引入超出当前阶段所需的抽象

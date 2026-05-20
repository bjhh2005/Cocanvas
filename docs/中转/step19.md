# 给下一个 AI 的交接说明

## 当前进度

按 [docs/04_开发计划.md](../04_开发计划.md) 推进，**第一阶段全部完成**，已到 **Step 19**：

- ✅ Step 1-6：项目骨架、Docker Compose、Nginx 反向代理、前后端联通
- ✅ Step 7-9：后端 `/ws/echo` Echo Handler，DevTools 手测回显
- ✅ Step 12：`RoomController` 提供 `POST /api/rooms`、`GET /api/rooms/{roomId}`
- ✅ Step 13：`RoomSessionRegistry` + `CollabWebSocketHandler` 骨架
- ✅ Step 14：协议 DTO 层（inbound sealed interface + outbound records）+ Jackson 多态反序列化单元测试
- ✅ Step 15：`CollabWebSocketHandler` 消息流完整串通
- ✅ Step 16：前端 React Router + Zustand `connectionStore`，Home 页"创建新房间"按钮 + 输入 ID 加入
- ✅ Step 17：Room 页在 `useEffect` 连接 `/ws/collab` 并发 `join`，订阅消息更新 store
- ✅ Step 18：鼠标 50ms 节流上报 `cursor`；`userStore` 维护 peers map
- ✅ Step 19：`CursorOverlay` 渲染远端光标（DOM + CSS transition 80ms 平滑补间）

第一阶段联通验证已跑通：**两台浏览器（或两个不同浏览器窗口）开同一个 roomId，互相看见对方的彩色光标**。

下一步是 **第二阶段 / Step 20+**：从 Konva 画布、矩形绘制开始。先确认用户想推进哪一步，不要擅自往下做。

## 必读文件（按优先级）

1. **[docs/04_开发计划.md](../04_开发计划.md)** —— step-by-step 推进顺序与验证标准
2. **[src/protocol/messages.md](../../src/protocol/messages.md)** —— 消息字段权威定义，前后端 DTO 都对这里
3. **[docs/07_前端Demo描述.md](../07_前端Demo描述.md)** —— 前端 UI 设计参考（HeaderBar、CursorOverlay、Toolbar 等设计依据）
4. **[docs/03_项目结构.md](../03_项目结构.md)** —— 包划分、关键架构决策
5. **[docs/08_网络结构文档.md](../08_网络结构文档.md)** —— Nginx 路由表、Docker vs Vite 直连
6. **[docs/05_接口文档.md](../05_接口文档.md)** —— REST + WS 协议契约

## 当前代码关键文件

### 后端（Step 13-15 已稳定，无新增）

| 文件 | 说明 |
|---|---|
| [protocol/inbound/InboundMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/InboundMessage.java) | sealed interface + `@JsonTypeInfo` |
| [protocol/inbound/JoinMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/JoinMessage.java) / [CursorMessage.java](../../src/backend/java/src/main/java/com/cocanvas/protocol/inbound/CursorMessage.java) | record |
| [protocol/outbound/*](../../src/backend/java/src/main/java/com/cocanvas/protocol/outbound/) | 5 个 outbound record，`type` 字段用额外方法注入 |
| [ws/CollabWebSocketHandler.java](../../src/backend/java/src/main/java/com/cocanvas/ws/CollabWebSocketHandler.java) | 消息分发；join 时把身份写入 `session.getAttributes()` |
| [ws/RoomSessionRegistry.java](../../src/backend/java/src/main/java/com/cocanvas/ws/RoomSessionRegistry.java) | `getSessions()` / `join()` / `leave()` / `broadcastInRoom()` |
| [controller/RoomController.java](../../src/backend/java/src/main/java/com/cocanvas/controller/RoomController.java) | `WS_URL` 硬编码 `ws://localhost:8080`，**前端没读这个字段**，但还是建议改成 `/ws/collab` 让前端拼 scheme |

### 前端（Step 16-19 全部新增）

```
src/frontend/app/src/
├── App.tsx                    路由根：/ → Home, /room/:roomId → Room
├── pages/
│   ├── Home.tsx + .css        创建/加入房间页
│   └── Room.tsx + .css        全屏工作区，挂 HeaderBar/CursorOverlay
├── components/
│   ├── HeaderBar.tsx + .css   房间 ID / 复制按钮 / 连接指示器 / 头像组
│   └── CursorOverlay.tsx + .css   pointer-events:none 的远端光标层
├── network/
│   ├── api.ts                 fetchHealth / createRoom / fetchRoom
│   └── websocket.ts           WSClient 单例 + COLLAB_WS_URL
├── store/
│   ├── connectionStore.ts     Zustand: status / roomId / 自己身份
│   └── userStore.ts           Zustand: peers Record<userId, PeerState>
├── protocol/messages.ts       与后端 record 对齐的 TS 类型
└── utils/
    ├── throttle.ts            50ms trailing 节流
    └── identity.ts            sessionStorage 持久化身份
```

### 基础设施

| 文件 | 说明 |
|---|---|
| [src/frontend/docker-compose.yml](../../src/frontend/docker-compose.yml) | 加了 `CI=true` 让 pnpm 在 lockfile 变更时自动清模块，不要求 TTY |
| [src/nginx/nginx.conf](../../src/nginx/nginx.conf) | 三条 location 不变 |
| [docker-compose.yml](../../docker-compose.yml) | `backend.deploy.replicas: 2`——**当前阶段实际只能用 1 副本**，见下面踩坑 |

## Step 16-19 实现要点

### 1. WSClient 是模块单例，**绝不放 React state / Zustand**

[network/websocket.ts](../../src/frontend/app/src/network/websocket.ts) 导出全局唯一的 `wsClient` 实例。组件通过 `onStatus` / `onMessage` 订阅，组件卸载时返回的清理函数取消订阅。store 只反映状态，不持有连接对象。

### 2. WSClient 的 staleness 守卫（**踩坑修复**）

React StrictMode 在 dev 双调 effect：第一次 mount 触发 `connect()` 创建 ws1，cleanup 立刻 `close()`，然后第二次 mount 再 `connect()` 创建 ws2。**ws1 的 async `onopen` 会迟到派发**，没有守卫的话会把 status 提前置 'connected'，导致 join 消息在 ws2 还未 OPEN 时尝试发送、静默 return false，然后注册的 join 监听器自我注销，永远不再发 join。

修法：每个 ws 事件处理器先判 `this.ws === ws`，老 ws 的回调直接 return。`close()` 也要先把 `this.ws = null` 再调 `ws.close()`，避免后到的 `onclose` 把新 ws 引用清掉。

### 3. Zustand selector 必须返回稳定引用（**踩坑修复**）

```tsx
// ❌ 错：每次返回新对象引用 → useSyncExternalStore 无限重渲染
useConnectionStore(s => ({ userId: s.userId, color: s.color }))
useUserStore(s => Object.values(s.peers))

// ✅ 拆成多个标量 selector
const userId = useConnectionStore(s => s.userId)

// ✅ 用 useShallow 浅比较
import { useShallow } from 'zustand/react/shallow'
const peers = useUserStore(useShallow(s => Object.values(s.peers)))
```

控制台 warning："The result of getSnapshot should be cached to avoid an infinite loop"——看到这条立刻按上面修。

### 4. 身份用 `sessionStorage` 不是 `localStorage`（**踩坑修复**）

[utils/identity.ts](../../src/frontend/app/src/utils/identity.ts) 用 `sessionStorage`，让**同一浏览器开多窗口能模拟多用户**。`localStorage` 是同源全标签共享，会导致两个标签 userId 撞车，userStore peers 是 `Record<userId, ...>`，撞车后互相覆盖到同一 key。

### 5. cursor 节流

`useMemo` 包 `throttle(fn, 50)`，依赖锁 `[roomId, identity]`，整页生命周期不变。trailing 策略保证停下时最后一格坐标也发出去。

### 6. CursorOverlay 平滑补间

DOM 层 `position: fixed; inset: 0; pointer-events: none; z-index: 50`。每个光标用 `transform: translate(x, y) + transition: transform 80ms linear`，GPU 加速，弥补 50ms 节流的离散感。**不用 Konva 渲染**——光标更新太频繁，DOM 性能更好且不触发画布重绘。

## 必须遵守的约定（含本阶段新踩的坑）

1. **后端 Controller 不要带 `/api/` 前缀**——Nginx 加，带了变成 `/api/api/rooms`
2. **新 WS endpoint 不用动 Nginx**——`/ws/` 已通配
3. **前端 WS 单例 + staleness 守卫**——见上文，StrictMode 必然引爆
4. **Zustand 派生 selector 用 `useShallow` 或拆成标量**——返回新对象 / 新数组会无限循环
5. **多标签调试用 sessionStorage**——不要再用 localStorage 写身份
6. **改了 lockfile 之后在容器里装依赖**：
   ```bash
   docker compose exec frontend pnpm add <pkg>      # 容器在跑
   docker compose run --rm frontend pnpm add <pkg>  # 容器没跑
   ```
   宿主机不要装 pnpm/node。当前宿主 node v20，pnpm 11 不兼容，硬装会走系统 node 报 `node:sqlite` 找不到
7. **WebSocket 选原生 `TextWebSocketHandler` 不选 STOMP**——会和后续一致性哈希/CRDT 冲突
8. **当前 Redis/MySQL/CRDT/一致性哈希全部不做**——开发计划没到这步前不要提前实现
9. **改了 nginx.conf 要 `docker compose restart nginx`**——挂载是 `:ro`
10. **出站 record 的 `type` 字段用额外方法**——别放进构造参数

## 当前阶段已知限制

### ⚠️ 后端必须缩到 1 副本才能协同

```bash
docker compose up -d --scale backend=1
```

`docker-compose.yml` 默认 `replicas: 2` 是"分布式核心"的卖点，但**当前阶段没有 Redis Pub/Sub 跨实例广播**，Nginx 轮询负载均衡会把同房间的两个 WS 打到不同 backend 实例，两个实例的 `RoomSessionRegistry` 是独立 JVM 内存对象，**互相看不见**，导致两个标签都进不了对方视野。

正确解法是开发计划 **Step 25-30 左右**：Redis Pub/Sub + 一致性哈希让同 roomId 永远落到同一实例 + 跨实例广播兜底。在那之前，所有协同测试用 `--scale backend=1`。

## 验证当前状态

```bash
# 起服务（注意必须 --scale backend=1）
docker compose up -d --scale backend=1

# 浏览器开两个标签，都打开 http://localhost
# 标签 A：点「创建新房间」→ 跳转 /room/xxxxxxxx
#         顶栏指示器从 amber「连接中」变 green「已连接」
#         自己的头像（带紫框）出现在右上
#
# 标签 B：复制 A 的 URL 粘到新标签（必须是 sessionStorage 独立标签，不是新窗口的 dup）
#         A 的头像出现在 B 右上，反之亦然
#
# 鼠标移动：A、B 互相看到对方的彩色光标 + 用户名标签
# 关闭一个标签 → 另一个标签上对应头像 + 光标消失

# 构建 / lint 通过：
docker compose exec frontend pnpm build
docker compose exec frontend pnpm lint

# 后端单元测试通过：
cd src/backend/java && ./gradlew test
```

后端运行时日志关键行（确认消息确实在流通）：

```
[collab] connection established: <session-id>
session <session-id> joined room <roomId>      ← 没看到这行说明 join 没到
```

## 用户偏好（已观察到的）

- 中文沟通，回复**简洁、不要过度总结**
- 改动后**主动跑端到端验证**（构建 / curl / DevTools / 容器日志），不要只说"应该没问题"
- 文档风格：表格 + 文件路径链接 + "易踩的坑"小节
- 代码：**不写无用注释**、不留 TODO 占位、Java 用 `record` 当 DTO、TS 用 `interface`+`type`
- **不要在宿主机装 pnpm/node**，全部走容器
- 不要主动 `commit/push`，用户自己决定提交时机

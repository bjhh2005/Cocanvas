# Protocol Messages v0.2

> 精确字段定义，供后端写 DTO、前端写 TypeScript interface 直接参考。
> 🟡 标记的字段今天（Step 7-27）**不要实现**，留作后续阶段占位。

---

## 公共约定

- 所有消息体：JSON 对象，UTF-8
- `type`：string，必填，Jackson 多态 discriminator
- `msgId`：string(UUID)，客户端→服务端时必填，服务端→客户端时省略
- `roomId`：string，客户端→服务端时冗余携带
- `userId`：string，客户端→服务端时必填
- ID 均为字符串，UUID 格式

---

## 一、客户端 → 服务端（Inbound）

### 1.1 `join`
进入房间，声明身份。**每次 WS 连接建立后必须发送的第一条业务消息。**

```json
{
  "type": "join",
  "msgId": "550e8400-e29b-41d4-a716-446655440000",
  "roomId": "a1b2c3d4",
  "userId": "u-11111111",
  "displayName": "Alice",
  "color": "#e74c3c"
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `type` | string | ✅ | 固定值 `"join"` |
| `msgId` | string | ✅ | UUID |
| `roomId` | string | ✅ | 房间 ID |
| `userId` | string | ✅ | 用户 UUID，前端 `crypto.randomUUID()` |
| `displayName` | string | ✅ | 1–20 字符 |
| `color` | string | ✅ | CSS 十六进制，如 `#e74c3c` |

---

### 1.2 `cursor`
上报鼠标位置，**前端 50ms 节流**。

```json
{
  "type": "cursor",
  "msgId": "550e8400-e29b-41d4-a716-446655440001",
  "roomId": "a1b2c3d4",
  "userId": "u-11111111",
  "x": 312.5,
  "y": 488.0
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `type` | string | ✅ | 固定值 `"cursor"` |
| `msgId` | string | ✅ | UUID |
| `roomId` | string | ✅ | |
| `userId` | string | ✅ | |
| `x` | number | ✅ | 画布坐标系 x，px |
| `y` | number | ✅ | 画布坐标系 y，px |

---

### 1.3 `op`
图形操作。**create/delete 无节流；update（拖动）前端 50ms 节流。**

```json
{
  "type": "op",
  "msgId": "550e8400-e29b-41d4-a716-446655440002",
  "roomId": "a1b2c3d4",
  "userId": "u-11111111",
  "hlc": "1716123456789.0.u-11111111",
  "op": {
    "opType": "create",
    "shapeId": "s-aaaaaaaa",
    "shapeType": "rect",
    "attrs": {
      "x": 100, "y": 120, "w": 100, "h": 80,
      "fill": "#3498db", "stroke": "#2980b9", "strokeWidth": 1
    }
  }
}
```

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `type` | string | ✅ | 固定值 `"op"` |
| `msgId` | string | ✅ | UUID |
| `roomId` | string | ✅ | |
| `userId` | string | ✅ | |
| `hlc` | string | 🟡 Step 30 | `物理ms.逻辑计数.nodeId` |
| `op` | object | ✅ | 见下方 Op 子对象 |

**Op 子对象**

| 字段 | 类型 | 必填 | 约束 |
|---|---|---|---|
| `opType` | enum | ✅ | `create` / `update` / `delete` |
| `shapeId` | string | ✅ | 前端 `crypto.randomUUID()` |
| `shapeType` | enum | create 必填 | `rect` / `circle` / `text` |
| `attrs` | object | create 必填 | 见 §三；update 为差量；delete 可省 |

**update 示例（差量，只含变化字段）：**
```json
{
  "type": "op",
  "msgId": "...",
  "roomId": "a1b2c3d4",
  "userId": "u-11111111",
  "op": {
    "opType": "update",
    "shapeId": "s-aaaaaaaa",
    "shapeType": "rect",
    "attrs": { "x": 220, "y": 180 }
  }
}
```

**delete 示例：**
```json
{
  "type": "op",
  "msgId": "...",
  "roomId": "a1b2c3d4",
  "userId": "u-11111111",
  "op": {
    "opType": "delete",
    "shapeId": "s-aaaaaaaa"
  }
}
```

---

### 1.4 `ping` 🟡 Step 47
心跳，30s 一次。

```json
{
  "type": "ping",
  "msgId": "...",
  "ts": 1716123456789
}
```

---

## 二、服务端 → 客户端（Outbound）

### 2.1 `joined`
**仅发给加入者本人**，告知当前房间内已有哪些 peer。

```json
{
  "type": "joined",
  "roomId": "a1b2c3d4",
  "you": {
    "userId": "u-11111111",
    "displayName": "Alice",
    "color": "#e74c3c"
  },
  "peers": [
    { "userId": "u-22222222", "displayName": "Bob",   "color": "#3498db" },
    { "userId": "u-33333333", "displayName": "Carol", "color": "#2ecc71" }
  ]
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定值 `"joined"` |
| `roomId` | string | 所在房间 |
| `you` | UserInfo | 自己的用户信息 |
| `peers` | UserInfo[] | 已在房间内的其他成员；若为第一个人则为空数组 |

**UserInfo 结构**

| 字段 | 类型 | 说明 |
|---|---|---|
| `userId` | string | |
| `displayName` | string | |
| `color` | string | |

---

### 2.2 `peer-joined`
广播给房间**其他人**，宣告新人到来。

```json
{
  "type": "peer-joined",
  "userId": "u-11111111",
  "displayName": "Alice",
  "color": "#e74c3c"
}
```

---

### 2.3 `peer-left`
广播给房间**其他人**，在 `afterConnectionClosed` 时触发。

```json
{
  "type": "peer-left",
  "userId": "u-11111111"
}
```

---

### 2.4 `cursor`（广播）
转发给房间**其他人**（去掉了 `msgId` 和 `roomId`）。

```json
{
  "type": "cursor",
  "userId": "u-11111111",
  "x": 312.5,
  "y": 488.0
}
```

---

### 2.5 `op`（广播）
转发给房间**其他人**。字段 `fromUserId` 替代原 `userId`，以区分方向。

```json
{
  "type": "op",
  "fromUserId": "u-11111111",
  "hlc": "1716123456789.0.u-11111111",
  "op": {
    "opType": "update",
    "shapeId": "s-aaaaaaaa",
    "shapeType": "rect",
    "attrs": { "x": 220, "y": 180 }
  }
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `type` | string | 固定值 `"op"` |
| `fromUserId` | string | 原始发送者 |
| `hlc` | string | 🟡 Step 30；今天可忽略 |
| `op` | object | 同入站 Op 子对象，原样透传 |

---

### 2.6 `snapshot` 🟡 Step 47
重连后服务端主动推送当前完整状态。

```json
{
  "type": "snapshot",
  "hlc": "1716123456789.0.node-a1b2",
  "shapes": [
    {
      "shapeId": "s-aaaaaaaa",
      "shapeType": "rect",
      "attrs": { "x": 220, "y": 180, "w": 100, "h": 80, "fill": "#3498db" }
    }
  ]
}
```

---

### 2.7 `pong` 🟡 Step 47

```json
{ "type": "pong", "ts": 1716123456789 }
```

---

### 2.8 `error`
服务端拒绝某条入站消息时回报错给**原始发送者**，**不关闭连接**。

```json
{
  "type": "error",
  "code": "invalid_message",
  "message": "missing required field: roomId",
  "refMsgId": "550e8400-e29b-41d4-a716-446655440000"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `type` | string | ✅ | 固定值 `"error"` |
| `code` | string | ✅ | 见错误码表 |
| `message` | string | ✅ | 可读错误描述 |
| `refMsgId` | string | 可选 | 引发错误的入站消息的 msgId |

**错误码表**

| code | 触发场景 | 阶段 |
|---|---|---|
| `invalid_message` | JSON 解析失败、字段缺失或类型错误 | ✅ |
| `unknown_type` | `type` 字段未识别 | ✅ |
| `not_joined` | 在 `join` 之前发送了 `cursor`/`op` | ✅ |
| `room_not_found` | 房间不存在 | 🟡 Step 39 |
| `room_full` | 房间人数超限 | 🟡 预留 |
| `rate_limited` | 发送过快 | 🟡 预留 |
| `internal_error` | 服务端未预期异常 | ✅ |

---

## 三、Shape `attrs` 字段表

### rect ✅ Step 23

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `x` | number | ✅ | 左上角 x |
| `y` | number | ✅ | 左上角 y |
| `w` | number | ✅ | 宽度 |
| `h` | number | ✅ | 高度 |
| `fill` | string | ✅ | 填充色 |
| `stroke` | string | 可选 | 描边色 |
| `strokeWidth` | number | 可选 | 描边宽度，默认 0 |

### circle ✅ Step 27

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `x` | number | ✅ | 圆心 x |
| `y` | number | ✅ | 圆心 y |
| `radius` | number | ✅ | 半径 |
| `fill` | string | ✅ | 填充色 |
| `stroke` | string | 可选 | |
| `strokeWidth` | number | 可选 | |

### text ✅ Step 27

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `x` | number | ✅ | 文本框左上角 x |
| `y` | number | ✅ | 文本框左上角 y |
| `text` | string | ✅ | 文本内容 |
| `fontSize` | number | ✅ | 字号，单位 px |
| `fill` | string | ✅ | 文字颜色 |
| `fontFamily` | string | 可选 | 默认 `sans-serif` |

---

## 四、后端 DTO 映射（成员 B 参考）

```
com.cocanvas.protocol.inbound
  ├── InboundMessage          (sealed / abstract, @JsonTypeInfo)
  ├── JoinMessage             type="join"
  ├── CursorMessage           type="cursor"
  ├── OpMessage               type="op"
  │     └── Op               (嵌套对象，含 opType/shapeId/shapeType/attrs)
  └── PingMessage             type="ping"   🟡

com.cocanvas.protocol.outbound
  ├── JoinedMessage           type="joined"  (含 you + peers[])
  ├── PeerJoinedMessage       type="peer-joined"
  ├── PeerLeftMessage         type="peer-left"
  ├── CursorBroadcastMessage  type="cursor"
  ├── OpBroadcastMessage      type="op"
  ├── SnapshotMessage         type="snapshot"  🟡
  ├── PongMessage             type="pong"      🟡
  └── ErrorMessage            type="error"
```

## 五、前端 TypeScript 接口映射（成员 C/D 参考）

```typescript
// inbound (C→S)
type InboundMessage = JoinMsg | CursorMsg | OpMsg

interface JoinMsg    { type: 'join';   msgId: string; roomId: string; userId: string; displayName: string; color: string }
interface CursorMsg  { type: 'cursor'; msgId: string; roomId: string; userId: string; x: number; y: number }
interface OpMsg      { type: 'op';     msgId: string; roomId: string; userId: string; hlc?: string; op: Op }

// outbound (S→C)
type OutboundMessage = JoinedMsg | PeerJoinedMsg | PeerLeftMsg | CursorBcastMsg | OpBcastMsg | ErrorMsg

interface JoinedMsg    { type: 'joined';      roomId: string; you: UserInfo; peers: UserInfo[] }
interface PeerJoinedMsg{ type: 'peer-joined'; userId: string; displayName: string; color: string }
interface PeerLeftMsg  { type: 'peer-left';   userId: string }
interface CursorBcastMsg{ type: 'cursor';     userId: string; x: number; y: number }
interface OpBcastMsg   { type: 'op';          fromUserId: string; hlc?: string; op: Op }
interface ErrorMsg     { type: 'error';       code: string; message: string; refMsgId?: string }

// shared
interface UserInfo { userId: string; displayName: string; color: string }
interface Op {
  opType: 'create' | 'update' | 'delete'
  shapeId: string
  shapeType?: 'rect' | 'circle' | 'text'
  attrs?: RectAttrs | CircleAttrs | TextAttrs | Partial<RectAttrs | CircleAttrs | TextAttrs>
}
interface RectAttrs   { x: number; y: number; w: number; h: number; fill: string; stroke?: string; strokeWidth?: number }
interface CircleAttrs { x: number; y: number; radius: number; fill: string; stroke?: string; strokeWidth?: number }
interface TextAttrs   { x: number; y: number; text: string; fontSize: number; fill: string; fontFamily?: string }
```

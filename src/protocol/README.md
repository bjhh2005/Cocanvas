# Protocol

本目录存放前后端 WebSocket 通信协议的**机器友好字段表**，由成员 B 在 Step 11 / Step 20 时维护。

## 文件说明

| 文件 | 内容 |
|---|---|
| `messages.md` | 所有消息类型的字段表 + JSON 样例（字段级别的精确定义） |

## 与接口文档的关系

- `docs/05_接口文档.md` 是**面向人**的协议叙述文档（时序图、使用说明、广播策略）
- 本目录是**面向实现**的精确字段表（后端 DTO 和前端 TypeScript interface 的参考）
- **字段必须与 `docs/05_接口文档.md` 保持一致**；发生冲突时以 `05_接口文档.md` 为准，并同步更新本目录

## 版本

| 版本 | Step | 变更 |
|---|---|---|
| v0.1 | Step 11 | 初始消息：join / cursor / joined / peer-joined / peer-left / error |
| v0.2 | Step 20 | 新增 op / op 广播（图形 CRUD） |
| v0.3 | Step 30 🟡 | op 消息加 hlc 字段 |

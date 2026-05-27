# Cocanvas

Cocanvas 是一个面向分布式系统课程大作业的多人实时协作白板。它支持多人进入同一房间, 实时同步鼠标光标和白板内容, 并演示 WebSocket 集群、Redis Pub/Sub、HLC/CRDT 冲突消解、MySQL 操作日志、snapshot/ops 历史恢复、一致性哈希路由、按节点 WebSocket 连接、故障重连和断线 pending op 补偿等分布式系统能力。

前端体验已经从基础画布升级为在线白板工作台, 支持便签、文本、常用形状、连接线、画笔、多选、评论、Frame、复制粘贴、Fit to content 和 PNG 导出。

## 功能概览

### 协作与可靠性

- 创建/加入协作房间。
- 多浏览器窗口实时同步远端光标。
- WebSocket 房间广播。
- Redis Pub/Sub 跨后端节点广播。
- 一致性哈希房间路由。
- WebSocket 真实按节点连接:
  - `/ws/backend1/collab`
  - `/ws/backend2/collab`
- WebSocket 断线重连与重新 join。
- 重连后通过历史恢复接口恢复当前画布。
- 断线期间本地操作进入 pending op 队列, 重连恢复后自动补发。
- `opId` 幂等去重, 避免 pending op 重放导致重复写日志。
- HLC 时间戳与属性级 LWW/CRDT 合并。
- MySQL 操作日志与周期性 snapshot。
- Redis 订阅端会将远端 op 同步到本节点 `RoomReplicaService`, 保证跨节点内存副本用于 snapshot 时不缺数据。
- 历史恢复当前从操作日志完整重放到目标时间, 避免已有不完整 snapshot 导致刷新丢失对象。

### 白板能力

- 无限画布风格工作台布局。
- 鼠标滚轮缩放、Hand 工具拖动画布。
- Fit to content。
- 左侧工具栏支持滚动与折叠。
- 便签 Sticky Note。
- 文本 Text, 支持双击内联编辑。
- 常用形状:
  - Rectangle
  - Rounded rectangle
  - Circle
  - Diamond
  - Triangle
- 样式编辑:
  - fill
  - stroke
  - strokeWidth
  - fontSize
  - shape 内文本
  - zIndex 前置/后置
- 连接线 Connector:
  - 支持对象到对象箭头连接。
  - 连接到目标对象本体即可自动吸附到最近边框。
  - 拖动物体时连接线实时跟随。
- 画笔 Pen:
  - 自由绘制路径。
  - 绘制过程中其他用户可实时看到预览线。
  - 松手后正式写入 CRDT/history。
- 选择与批量操作:
  - 单选。
  - Shift 多选。
  - 空白区域框选。
  - 批量拖动。
  - 批量删除。
- 复制/粘贴:
  - `Ctrl/Cmd + C`
  - `Ctrl/Cmd + V`
- 评论 Comment:
  - 点击画布创建评论。
  - 双击编辑评论文本。
  - 支持 Done/Open resolved 状态。
- Frame:
  - 拖拽创建分区框。
  - 显示标题。
  - 用于组织大白板内容。
- PNG 导出当前画布视口。

### 快捷键

- `V`: Select
- `H`: Hand
- `N`: Sticky
- `T`: Text
- `P`: Pen
- `C`: Comment
- `F`: Frame
- `Delete/Backspace`: 删除选中对象
- `Ctrl/Cmd + C`: 复制
- `Ctrl/Cmd + V`: 粘贴

## 技术栈

前端:

- React 19
- TypeScript
- Vite
- Zustand
- Konva / react-konva
- React Router

后端:

- Java 21
- Spring Boot 3.5
- Spring MVC
- Spring WebSocket
- Spring Data Redis
- Spring Data JPA
- MySQL
- H2 测试数据库

基础设施:

- Docker Compose
- Nginx
- Redis
- MySQL

## 目录结构

```text
Cocanvas/
  docs/                  项目文档
  src/
    backend/java/        Spring Boot 后端
    frontend/app/        React + Vite 前端
    nginx/               Nginx 反向代理配置
    protocol/            WebSocket 协议文档
  docker-compose.yml     全栈 Docker Compose
  run.bat                Windows 启动脚本
  run.sh                 Linux/macOS 启动脚本
```

关键文件:

- `src/backend/java/src/main/java/com/cocanvas/ws/CollabWebSocketHandler.java`: WebSocket 协作入口。
- `src/backend/java/src/main/java/com/cocanvas/ws/RoomSessionRegistry.java`: 房间 session 注册表。
- `src/backend/java/src/main/java/com/cocanvas/crdt/HybridLogicalClock.java`: 后端 HLC。
- `src/backend/java/src/main/java/com/cocanvas/service/RoomReplicaService.java`: 后端房间内存副本。
- `src/backend/java/src/main/java/com/cocanvas/service/HistoryService.java`: 操作日志、snapshot 与历史恢复; 当前从 ops 重放规避旧坏 snapshot。
- `src/backend/java/src/main/java/com/cocanvas/pubsub/RedisRoomEventSubscriber.java`: Redis Pub/Sub 订阅端, 将远端 op 广播给本节点客户端并同步到本节点副本。
- `src/backend/java/src/main/java/com/cocanvas/pubsub/`: Redis Pub/Sub 广播。
- `src/backend/java/src/main/java/com/cocanvas/persistence/repository/OperationLogRepository.java`: 操作日志查询, 支撑历史恢复。
- `src/backend/java/src/main/java/com/cocanvas/routing/`: 一致性哈希路由。
- `src/backend/java/src/main/java/com/cocanvas/cluster/`: 节点注册与节点信息。
- `src/frontend/app/src/pages/Room.tsx`: 前端协作房间页。
- `src/frontend/app/src/components/CanvasBoard.tsx`: Konva 白板画布。
- `src/frontend/app/src/components/Toolbar.tsx`: 左侧工具栏与对象创建工厂。
- `src/frontend/app/src/store/shapeStore.ts`: 前端图形状态与 CRDT 合并。
- `src/frontend/app/src/types/protocol.ts`: 前端协议类型。
- `src/protocol/messages.md`: WebSocket 消息协议。

## 快速启动: Docker Compose

推荐优先使用 Docker Compose。需要先启动 Docker Desktop。

Windows:

```powershell
cd E:\Corcanvas\Cocanvas
.\run.bat dev
```

Linux/macOS:

```bash
cd /path/to/Cocanvas
./run.sh dev
```

启动完成后访问:

```text
http://localhost/
```

后台启动:

```powershell
.\run.bat up
.\run.bat logs
```

查看容器状态:

```powershell
.\run.bat ps
```

停止服务:

```powershell
.\run.bat down
```

清理容器和 MySQL 数据卷:

```powershell
.\run.bat clean
```

Docker Compose 会启动以下服务:

- `nginx`: 统一入口, 监听 `80`。
- `frontend`: Vite 前端。
- `backend1`: Spring Boot 后端节点 1。
- `backend2`: Spring Boot 后端节点 2。
- `redis`: Redis Pub/Sub 与节点心跳。
- `mysql`: 操作日志与 snapshot 持久化。

## 备用启动: 本地开发模式

如果 Docker Hub 镜像拉取失败, 可以使用本地开发模式快速看效果。该方式只需要 Docker 跑 MySQL, 前后端在本机运行。

1. 启动 MySQL:

```powershell
docker run -d --name cocanvas-mysql-local `
  -e MYSQL_ROOT_PASSWORD=cocanvas123 `
  -e MYSQL_DATABASE=cocanvas `
  -p 3307:3306 `
  mysql:8.0.36
```

如果容器已存在:

```powershell
docker start cocanvas-mysql-local
```

2. 启动后端:

```powershell
cd E:\Corcanvas\Cocanvas\src\backend\java
$env:MYSQL_URL='jdbc:mysql://localhost:3307/cocanvas?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC'
$env:MYSQL_USER='root'
$env:MYSQL_PASSWORD='cocanvas123'
$env:REALTIME_BROADCASTER='local'
.\gradlew.bat bootRun --args="--server.port=8081"
```

3. 启动前端:

```powershell
cd E:\Corcanvas\Cocanvas\src\frontend\app
$env:VITE_PROXY_TARGET='http://localhost:8081'
corepack pnpm install --frozen-lockfile
.\node_modules\.bin\vite.cmd --host 127.0.0.1 --port 5173
```

访问:

```text
http://127.0.0.1:5173/
```

## 演示流程

### 基础协作

1. 打开首页, 点击 `Create room` 创建房间。
2. 复制当前 `/room/<roomId>` 地址。
3. 打开第二个浏览器窗口或无痕窗口, 访问同一个房间地址。
4. 在任意窗口移动鼠标, 另一个窗口应看到远端光标。
5. 创建 Sticky、Text、Rect、Circle 或其他形状。
6. 拖动对象, 另一个窗口应实时同步位置。
7. 选中对象, 点击 `Delete` 或按 Delete/Backspace, 另一个窗口应同步删除。

### 白板工具

1. 创建 Sticky, 双击编辑文本。
2. 创建 Text, 双击编辑文本。
3. 创建多种形状, 修改 fill、stroke、strokeWidth、fontSize。
4. 使用 Connector 连接两个对象。
5. 拖动被连接对象, 观察连接线端点实时跟随。
6. 使用 Pen 绘制, 另一个窗口应在绘制过程中看到预览线。
7. 使用 Select 空白拖拽框选多个对象。
8. Shift 点击多选。
9. 批量拖动或删除多个对象。
10. 使用 Comment 创建评论, 双击编辑, 切换 Done/Open。
11. 使用 Frame 拖拽创建分区。
12. 点击 Fit 适配当前内容。
13. 点击 PNG 导出当前画布视口。

### 故障恢复

1. Docker Compose 模式下打开两个窗口加入同一房间。
2. 在浏览器开发者工具中观察 WebSocket URL, 应为 `/ws/backend1/collab` 或 `/ws/backend2/collab`。
3. 停止当前窗口连接的后端节点。
4. 前端应进入重连流程, 重新查询 room 路由并连接新的 `wsUrl`。
5. 重连后前端会拉取 history, 当前通过从空状态重放截至当前时间的 ops 恢复画布。
6. 断线期间产生的本地操作会进入 pending 队列, 恢复后自动补发。
7. 创建对象后等待一段时间再刷新页面, 对象应仍然存在, 用于验证跨节点副本同步与历史恢复。

## 常用接口

健康检查:

```text
GET /api/health
```

创建房间:

```text
POST /api/rooms
```

查询房间:

```text
GET /api/rooms/{roomId}
```

历史查询:

```text
GET /api/rooms/{roomId}/history?at={timestampMs}
```

节点列表:

```text
GET /api/cluster/nodes
```

WebSocket:

```text
ws://<host>/ws/collab
ws://<host>/ws/backend1/collab
ws://<host>/ws/backend2/collab
```

## 验证命令

后端测试:

```powershell
cd E:\Corcanvas\Cocanvas\src\backend\java
.\gradlew.bat test --no-daemon --console=plain
```

前端构建:

```powershell
cd E:\Corcanvas\Cocanvas
docker compose exec -T frontend pnpm build
```

或本机前端构建:

```powershell
cd E:\Corcanvas\Cocanvas\src\frontend\app
corepack pnpm install --frozen-lockfile
pnpm build
```

Docker Compose 配置检查:

```powershell
cd E:\Corcanvas\Cocanvas
docker compose config --quiet
```

后端可靠性代码修改后重建并重启后端容器:

```powershell
cd E:\Corcanvas\Cocanvas
docker compose build backend1 backend2
docker compose up -d backend1 backend2
```

如果 Docker Hub 拉取基础镜像时出现网络 EOF 或超时, 通常是 Docker 网络或代理问题, 修复网络后重试即可。

## 文档索引

- `docs/01_设计文档.md`: 设计说明。
- `docs/02_需求文档.md`: 需求说明。
- `docs/03_项目结构.md`: 项目结构与模块职责。
- `docs/04_开发计划.md`: 分阶段开发计划。
- `docs/05_接口文档.md`: REST 和 WebSocket 接口约定。
- `docs/06_本次实现总结.md`: 早期阶段实现总结。
- `docs/07_前端白板产品化功能设计与计划.md`: 前端白板产品化设计与计划。
- `docs/08_阶段实现总结.md`: 本阶段可靠协作链路与前端产品化实现总结。

## 当前实现边界

- 历史回放目前会将历史状态应用到实时 `shapeStore`, 后续可拆成独立 replay store。
- 为了规避已有不完整 snapshot, 历史恢复当前会完整重放房间 ops 到目标时间; 数据量变大后可在跨节点 snapshot 可信后恢复为 snapshot + delta 模式。
- pending op 队列目前保存在前端内存中, 页面刷新会丢失尚未 flush 的 pending op; 后续可落到 localStorage 或 IndexedDB。
- 多选批量移动目前释放时对每个对象发送 update op, 后续可设计 batch op。
- PNG 导出目前导出当前 canvas 视口, 后续可支持导出完整内容范围。
- Comment 当前是轻量版本, 后续可增加作者、时间、线程回复和 @ 提及。
- Frame 当前主要是视觉分区, 后续可支持内部对象归属和演示模式。
- 当前没有用户登录和权限系统, 任何拿到 roomId 的用户都可以加入房间。

## 常见问题

### 1. 访问 localhost 显示 ERR_CONNECTION_REFUSED

通常是服务没有启动。先检查 Docker Desktop 是否已启动, 再运行:

```powershell
.\run.bat ps
```

如果没有容器, 执行:

```powershell
.\run.bat dev
```

### 2. Docker 拉取 nginx、redis、mysql 镜像失败

这是 Docker Desktop 网络或代理问题。可以选择:

- 给 Docker Desktop 配置 HTTPS 代理或镜像源。
- 使用上面的本地开发模式。
- 如果本机已有相近镜像, 临时调整 `docker-compose.yml` 中的镜像 tag。

### 3. 80 端口被占用

修改 `docker-compose.yml`:

```yaml
nginx:
  ports:
    - "8088:80"
```

然后访问:

```text
http://localhost:8088/
```

### 4. 后端 8080 被占用

本地开发模式下可以改为 8081:

```powershell
.\gradlew.bat bootRun --args="--server.port=8081"
```

前端代理也要同步设置:

```powershell
$env:VITE_PROXY_TARGET='http://localhost:8081'
```

### 5. Vite 构建提示 chunk 超过 500KB

这是 Konva 相关依赖体积较大导致的构建警告, 不影响运行。后续如需优化, 可以做代码分割或调整 Vite chunk 警告阈值。

### 6. 添加物品后短时间刷新存在, 过一段时间刷新丢失

旧版本的原因是 Redis Pub/Sub 订阅端只把远端 op 广播给本节点客户端, 没有同步到本节点 `RoomReplicaService`。某个后端节点如果随后基于空/旧副本写出 snapshot, 历史恢复命中该 snapshot 后就可能丢失早期对象。

当前修复包含两层:

- 订阅端收到远端 op 后会同步应用到本节点副本, 但不会重复写 MySQL 操作日志。
- 历史恢复暂时从操作日志完整重放到目标时间, 避免已有坏 snapshot 继续影响刷新恢复。

修改后需要重建并重启后端容器:

```powershell
docker compose build backend1 backend2
docker compose up -d backend1 backend2
```

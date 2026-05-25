# Cocanvas

Cocanvas 是一个面向分布式系统课程大作业的多人实时协作白板。它支持多人进入同一房间,实时同步鼠标光标和图形操作,并演示 WebSocket 集群、Redis Pub/Sub、HLC/CRDT 冲突消解、MySQL 操作日志、历史回放、一致性哈希路由和故障重连等分布式系统能力。

## 功能概览

- 创建/加入协作房间
- 多浏览器窗口实时同步远端光标
- 基于 Konva 的画布渲染
- 创建、拖动、删除矩形、圆形、文本
- WebSocket 房间广播
- HLC 时间戳与属性级 LWW/CRDT 合并
- Redis Pub/Sub 跨后端节点广播
- MySQL 操作日志与快照
- 历史查询与基础时光回放
- 一致性哈希房间路由
- WebSocket 断线重连与重新 join

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

- `src/backend/java/src/main/java/com/cocanvas/ws/CollabWebSocketHandler.java`: WebSocket 协作入口
- `src/backend/java/src/main/java/com/cocanvas/ws/RoomSessionRegistry.java`: 房间 session 注册表
- `src/backend/java/src/main/java/com/cocanvas/crdt/HybridLogicalClock.java`: 后端 HLC
- `src/backend/java/src/main/java/com/cocanvas/service/RoomReplicaService.java`: 后端房间副本
- `src/backend/java/src/main/java/com/cocanvas/pubsub/`: Redis Pub/Sub 广播
- `src/backend/java/src/main/java/com/cocanvas/routing/`: 一致性哈希路由
- `src/frontend/app/src/pages/Room.tsx`: 前端协作房间页
- `src/frontend/app/src/store/shapeStore.ts`: 前端图形状态与 CRDT 合并
- `src/frontend/app/src/components/CanvasBoard.tsx`: Konva 画布
- `src/protocol/messages.md`: WebSocket 消息协议

## 快速启动: Docker Compose

推荐新同学优先使用 Docker Compose。需要先启动 Docker Desktop。

Windows:

```powershell
cd D:\Cocanvas
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

停止服务:

```powershell
.\run.bat down
```

清理容器和 MySQL 数据卷:

```powershell
.\run.bat clean
```

Docker Compose 会启动以下服务:

- `nginx`: 统一入口,监听 `80`
- `frontend`: Vite 前端
- `backend1`: Spring Boot 后端节点 1
- `backend2`: Spring Boot 后端节点 2
- `redis`: Redis Pub/Sub 与节点心跳
- `mysql`: 操作日志与快照持久化

## 备用启动: 本地开发模式

如果 Docker Hub 镜像拉取失败,可以用本地开发模式快速看效果。该方式只需要 Docker 跑 MySQL,前后端在本机运行。

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
cd D:\Cocanvas\src\backend\java
$env:MYSQL_URL='jdbc:mysql://localhost:3307/cocanvas?useSSL=false&allowPublicKeyRetrieval=true&serverTimezone=UTC'
$env:MYSQL_USER='root'
$env:MYSQL_PASSWORD='cocanvas123'
$env:REALTIME_BROADCASTER='local'
.\gradlew.bat bootRun --args="--server.port=8081"
```

3. 启动前端:

```powershell
cd D:\Cocanvas\src\frontend\app
$env:VITE_PROXY_TARGET='http://localhost:8081'
corepack pnpm install --frozen-lockfile
.\node_modules\.bin\vite.cmd --host 127.0.0.1 --port 5173
```

访问:

```text
http://127.0.0.1:5173/
```

## 演示流程

1. 打开首页,点击 `Create room` 创建房间。
2. 复制当前 `/room/<roomId>` 地址。
3. 打开第二个浏览器窗口或无痕窗口,访问同一个房间地址。
4. 在任意窗口移动鼠标,另一个窗口应看到远端光标。
5. 点击 `Rect`、`Circle`、`Text` 创建图形。
6. 拖动图形,另一个窗口应实时同步位置。
7. 选中图形,点击 `Delete` 或按 Delete/Backspace,另一个窗口应同步删除。
8. 使用 `Time travel timestamp` 和 `Load history` 测试历史查询与回放。
9. Docker Compose 模式下可停止一个后端容器,观察前端自动重连。

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
```

## 验证命令

后端测试:

```powershell
cd D:\Cocanvas\src\backend\java
.\gradlew.bat test --no-daemon --console=plain
```

前端构建:

```powershell
cd D:\Cocanvas\src\frontend\app
.\node_modules\.bin\tsc.cmd -b
.\node_modules\.bin\vite.cmd build
```

Docker Compose 配置检查:

```powershell
cd D:\Cocanvas
docker compose config --quiet
```

## 常见问题

### 1. 访问 localhost 显示 ERR_CONNECTION_REFUSED

通常是服务没有启动。先检查 Docker Desktop 是否已启动,再运行:

```powershell
.\run.bat ps
```

如果没有容器,执行:

```powershell
.\run.bat dev
```

### 2. Docker 拉取 nginx、redis、mysql 镜像失败

这是 Docker Desktop 网络或代理问题。可以选择:

- 给 Docker Desktop 配置 HTTPS 代理或镜像源
- 使用上面的“本地开发模式”
- 如果本机已有相近镜像,临时改 `docker-compose.yml` 中的镜像 tag

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

这是 Konva 相关依赖体积较大导致的构建警告,不影响运行。后续如需优化,可以做代码分割或调整 Vite chunk 警告阈值。

## 文档索引

- `docs/01_设计文档.md`: 设计说明
- `docs/02_需求文档.md`: 需求说明
- `docs/03_项目结构.md`: 项目结构与模块职责
- `docs/04_开发计划.md`: 分阶段开发计划
- `docs/05_接口文档.md`: REST 和 WebSocket 接口约定
- `docs/06_本次实现总结.md`: 本次实现内容汇总

## 当前实现边界

- 历史回放目前是基础演示版,会将历史状态应用到当前画布 store,还不是完全独立的只读回放视图。
- 故障切换已具备重新查询路由和重连能力,生产级场景仍需要更完善的断线操作重放、幂等去重和用户提示。
- 当前没有用户登录和权限系统,任何拿到 roomId 的用户都可以加入房间。

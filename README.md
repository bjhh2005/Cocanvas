# Cocanvas

Cocanvas 是一个多人实时协作白板, 也是一个面向分布式系统课程展示的工程项目。它支持多人进入同一房间, 实时同步光标和白板操作, 并通过多后端 WebSocket 集群、Redis Pub/Sub、HLC/CRDT、MySQL 操作日志、snapshot 恢复和一致性哈希路由展示分布式协作系统的核心链路。

## 项目架构

```text
Browser
  |
  | HTTP / WebSocket
  v
Nginx :8088
  |-- /api/*              -> backend1/backend2
  |-- /ws/backend1/collab -> backend1
  |-- /ws/backend2/collab -> backend2
  `-- /                  -> frontend(Vite)

backend1/backend2
  |-- Spring WebSocket: 房间连接、光标、op、ack
  |-- SessionSendQueue: 慢客户端背压和 transient 消息丢弃
  |-- RoomReplicaService: 内存副本 + HLC/CRDT 合并
  |-- HistoryService: MySQL op log + versioned snapshot
  |-- NodeRouter: Redis 节点发现 + 一致性哈希
  `-- Redis Pub/Sub: 跨节点房间事件分片广播

Redis
  |-- cocanvas:nodes 节点索引
  |-- cocanvas:room-events:{0..63} 分片广播
  `-- cocanvas:room-transient-events:{0..63} transient 分片广播

MySQL
  |-- rooms
  |-- operation_logs
  `-- snapshots
```

## 技术选型

前端:

- React 19 + TypeScript + Vite
- Zustand 状态管理
- Konva / react-konva 白板画布
- React Router

后端:

- Java 21
- Spring Boot 3.5
- Spring MVC + Spring WebSocket
- Spring Data Redis + Lettuce
- Spring Data JPA
- HLC + 属性级 LWW/CRDT

基础设施:

- Docker Compose
- Nginx
- Redis 7
- MySQL 8

## 快速启动

推荐使用 Docker Compose 启动完整分布式链路。

```powershell
cd Cocanvas
docker compose up -d --build
```

如果 Windows 禁止绑定 MySQL 默认宿主端口 `3307`, 可以换一个端口:

```powershell
$env:MYSQL_HOST_PORT='3317'
docker compose up -d --build
```

访问:

```text
http://localhost:8088/
```

查看服务:

```powershell
docker compose ps
```

停止:

```powershell
docker compose down
```

## 快速验证

健康检查:

```powershell
Invoke-RestMethod http://localhost:8088/api/health
```

节点列表:

```powershell
Invoke-RestMethod http://localhost:8088/api/cluster/nodes
```

分布式功能与性能脚本:

```powershell
node scripts\distributed-check.mjs
```

前端构建:

```powershell
docker compose exec -T frontend pnpm build
```

后端测试:

```powershell
docker run --rm `
  -v "${PWD}\src\backend\java:/workspace" `
  -v cocanvas-gradle-cache:/root/.gradle `
  -w /workspace `
  eclipse-temurin:21-jdk `
  sh -lc "./gradlew test --no-daemon"
```

## 当前能力

- 房间创建、查询、更新、归档。
- 房间密码、访问模式、权限模式字段、短期 join token。
- 多人 WebSocket join、peer joined/left、远端光标。
- 白板对象创建、拖动、编辑、删除、连接线、画笔、评论、Frame、分组、多选。
- HLC/CRDT 属性级合并。
- Redis Pub/Sub 跨节点广播。
- cursor / shape-preview transient 低优先级广播。
- WebSocket 每 session 独立发送队列和慢客户端背压。
- 后端执行 `view` / `comment` 写入权限校验。
- 一致性哈希按房间路由到后端节点。
- op 持久化成功后 ack 和广播。
- 前端 pending op outbox, 支持断线重连后补发。
- MySQL 操作日志和 versioned snapshot 历史恢复。
- owner 节点写 snapshot, 避免多节点重复快照。

## 文档入口

- [docs/README.md](docs/README.md): 文档索引。
- [docs/功能清单.md](docs/功能清单.md): 当前功能清单与已知限制。
- [docs/架构说明.md](docs/架构说明.md): 当前架构与关键数据流。
- [docs/接口文档.md](docs/接口文档.md): 当前 REST/WebSocket 协议。
- [docs/progress/](docs/progress): 开发进度、测试结果与后续计划。

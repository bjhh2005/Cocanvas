package com.cocanvas.service;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.atomic.AtomicBoolean;

import com.cocanvas.persistence.entity.OperationLogEntity;
import com.cocanvas.persistence.entity.SnapshotEntity;
import com.cocanvas.persistence.repository.OperationLogRepository;
import com.cocanvas.persistence.repository.SnapshotRepository;
import com.cocanvas.protocol.common.ShapeOperation;
import com.cocanvas.routing.NodeRouter;
import com.cocanvas.cluster.NodeIdentity;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class HistoryService {

    private static final Logger log = LoggerFactory.getLogger(HistoryService.class);

    private final OperationLogRepository operationLogRepository;
    private final SnapshotRepository snapshotRepository;
    private final RoomReplicaService replicaService;
    private final ObjectMapper objectMapper;
    private final NodeRouter nodeRouter;
    private final NodeIdentity nodeIdentity;

    // 批量写后置：op 先入缓冲队列，按数量或时间触发一次性批量 INSERT，把 N 次事务合并成一次。
    private static final int BATCH_MAX = 200;
    private final BlockingQueue<PendingOp> writeBuffer = new LinkedBlockingQueue<>();
    private final ExecutorService persistExecutor = Executors.newVirtualThreadPerTaskExecutor();
    private final AtomicBoolean flushing = new AtomicBoolean(false);

    private record PendingOp(String roomId, String userId, String hlc, ShapeOperation op) {}

    public HistoryService(
            OperationLogRepository operationLogRepository,
            SnapshotRepository snapshotRepository,
            RoomReplicaService replicaService,
            ObjectMapper objectMapper,
            NodeRouter nodeRouter,
            NodeIdentity nodeIdentity
    ) {
        this.operationLogRepository = operationLogRepository;
        this.snapshotRepository = snapshotRepository;
        this.replicaService = replicaService;
        this.objectMapper = objectMapper;
        this.nodeRouter = nodeRouter;
        this.nodeIdentity = nodeIdentity;
    }

    public void recordOperation(String roomId, String userId, String hlc, ShapeOperation op) {
        tryRecordOperation(roomId, userId, hlc, op);
    }

    /** 入缓冲队列，立即返回，不阻塞 ack。队列达到阈值时触发一次即时批量 flush。 */
    public void recordOperationAsync(String roomId, String userId, String hlc, ShapeOperation op) {
        writeBuffer.offer(new PendingOp(roomId, userId, hlc, op));
        if (writeBuffer.size() >= BATCH_MAX) {
            persistExecutor.execute(this::flushWriteBuffer);
        }
    }

    /** 定时批量落库：把缓冲区的 op 一次性 saveAll，失败回退逐条保存。 */
    @Scheduled(fixedDelayString = "${history.flush-interval-ms:200}")
    public void flushWriteBuffer() {
        if (writeBuffer.isEmpty() || !flushing.compareAndSet(false, true)) {
            return;
        }
        try {
            List<PendingOp> batch = new ArrayList<>(BATCH_MAX);
            writeBuffer.drainTo(batch, BATCH_MAX);
            if (batch.isEmpty()) {
                return;
            }
            // 批内按 opId 去重，构建实体
            Map<String, OperationLogEntity> entities = new LinkedHashMap<>();
            for (PendingOp p : batch) {
                try {
                    OperationLogEntity entity = buildOpEntity(p.roomId(), p.userId(), p.hlc(), p.op());
                    entities.put(entity.getOpId(), entity);
                } catch (Exception e) {
                    log.warn("Build op entity failed: {}", e.getMessage());
                }
            }
            if (entities.isEmpty()) {
                return;
            }
            try {
                operationLogRepository.saveAll(entities.values());
            } catch (Exception e) {
                // 整批失败（如某 opId 已存在）→ 回退逐条保存，跳过重复/坏数据
                log.warn("Batch persist of {} ops failed, retrying individually: {}", entities.size(), e.getMessage());
                entities.values().forEach(entity -> {
                    try {
                        operationLogRepository.save(entity);
                    } catch (Exception ignored) {
                        // 重复或其它错误，丢弃单条（实时状态已在内存副本，且有周期快照兜底）
                    }
                });
            }
        } finally {
            flushing.set(false);
        }
    }

    private OperationLogEntity buildOpEntity(String roomId, String userId, String hlc, ShapeOperation op) throws Exception {
        String opId = op.opId() == null || op.opId().isBlank()
                ? UUID.randomUUID().toString()
                : op.opId();
        OperationLogEntity entity = new OperationLogEntity();
        entity.setOpId(opId);
        entity.setRoomId(roomId);
        entity.setUserId(userId);
        entity.setHlc(hlc);
        entity.setOpType(op.opType());
        entity.setShapeId(op.shapeId());
        entity.setShapeType(op.shapeType());
        entity.setCreatedAt(System.currentTimeMillis());
        entity.setPayload(objectMapper.writeValueAsString(op));
        return entity;
    }

    public boolean tryRecordOperation(String roomId, String userId, String hlc, ShapeOperation op) {
        try {
            String opId = op.opId() == null || op.opId().isBlank()
                    ? UUID.randomUUID().toString()
                    : op.opId();
            if (operationLogRepository.existsById(opId)) {
                return true;
            }
            operationLogRepository.save(buildOpEntity(roomId, userId, hlc, op));
            return true;
        } catch (DataIntegrityViolationException ignored) {
            return true;
        } catch (Exception ignored) {
            return false;
        }
    }

    @Scheduled(fixedRateString = "${history.snapshot-interval-ms:60000}")
    public void snapshotActiveRooms() {
        replicaService.roomIds().forEach(this::saveSnapshot);
    }

    /**
     * Timeline anchors for the history slider UI:
     * - roomCreatedAt: left edge of the slider
     * - snapshots: positions to render as tick marks
     * - latestOpAt: right edge (most recent activity)
     */
    public HistoryAnchors anchors(String roomId, long roomCreatedAt) {
        List<Long> snapshots = snapshotRepository.findCreatedAtByRoomIdOrderByCreatedAtAsc(roomId);
        long latestOpAt = operationLogRepository.findMaxCreatedAtByRoomId(roomId)
                .orElse(System.currentTimeMillis());
        return new HistoryAnchors(roomCreatedAt, snapshots, latestOpAt);
    }

    public HistoryResponse history(String roomId, long at) {
        HistorySnapshot snapshot = snapshotRepository
                .findFirstByRoomIdAndCreatedAtLessThanEqualOrderByCreatedAtDesc(roomId, at)
                .map(this::toHistorySnapshot)
                .orElseGet(() -> new HistorySnapshot("replay-from-start-" + roomId, "", 0, "{}"));

        List<HistoryOp> ops = operationLogRepository
                .findByRoomIdAndCreatedAtGreaterThanEqualAndCreatedAtLessThanEqualOrderByCreatedAtAsc(
                        roomId,
                        snapshot.createdAt(),
                        at
                )
                .stream()
                .map(this::toHistoryOp)
                .toList();

        return new HistoryResponse(snapshot, ops);
    }

    private void saveSnapshot(String roomId) {
        try {
            if (!nodeIdentity.nodeId().equals(nodeRouter.routeRoom(roomId).nodeId())) {
                return;
            }

            long now = System.currentTimeMillis();
            SnapshotEntity entity = new SnapshotEntity();
            entity.setSnapshotId(UUID.randomUUID().toString());
            entity.setRoomId(roomId);
            entity.setCreatedAt(now);
            entity.setHlc("");
            entity.setPayload(objectMapper.writeValueAsString(replicaService.versionedSnapshot(roomId)));
            snapshotRepository.save(entity);

            // Prune op logs that are fully covered by the previous snapshot.
            // Strategy: keep ops from the second-most-recent snapshot onwards so any
            // point in time can still be replayed (snapshot N-1 + ops[N-1..at]).
            snapshotRepository.findFirstByRoomIdAndCreatedAtLessThanOrderByCreatedAtDesc(roomId, now)
                    .ifPresent(prev -> {
                        int deleted = operationLogRepository.deleteByRoomIdAndCreatedAtBefore(roomId, prev.getCreatedAt());
                        if (deleted > 0) {
                            // Logged at debug level — pruning is routine housekeeping.
                            org.slf4j.LoggerFactory.getLogger(HistoryService.class)
                                    .debug("Pruned {} op logs for room {} (before snapshot {})", deleted, roomId, prev.getSnapshotId());
                        }
                    });
        } catch (Exception ignored) {
            // Snapshotting should never interrupt live collaboration.
        }
    }

    private HistoryOp toHistoryOp(OperationLogEntity entity) {
        return new HistoryOp(
                entity.getOpId(),
                entity.getUserId(),
                entity.getHlc(),
                entity.getCreatedAt(),
                entity.getPayload()
        );
    }

    private HistorySnapshot toHistorySnapshot(SnapshotEntity entity) {
        return new HistorySnapshot(
                entity.getSnapshotId(),
                entity.getHlc(),
                entity.getCreatedAt(),
                entity.getPayload()
        );
    }

    public record HistoryResponse(HistorySnapshot snapshot, List<HistoryOp> ops) {
    }

    public record HistorySnapshot(String snapshotId, String hlc, long createdAt, String payload) {
    }

    public record HistoryOp(String opId, String userId, String hlc, long createdAt, String payload) {
    }

    public record HistoryAnchors(long roomCreatedAt, List<Long> snapshots, long latestOpAt) {
    }
}

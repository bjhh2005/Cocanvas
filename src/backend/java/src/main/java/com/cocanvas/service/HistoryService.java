package com.cocanvas.service;

import java.util.List;
import java.util.UUID;

import com.cocanvas.persistence.entity.OperationLogEntity;
import com.cocanvas.persistence.entity.SnapshotEntity;
import com.cocanvas.persistence.repository.OperationLogRepository;
import com.cocanvas.persistence.repository.SnapshotRepository;
import com.cocanvas.protocol.common.ShapeOperation;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;

@Service
public class HistoryService {

    private final OperationLogRepository operationLogRepository;
    private final SnapshotRepository snapshotRepository;
    private final RoomReplicaService replicaService;
    private final ObjectMapper objectMapper;

    public HistoryService(
            OperationLogRepository operationLogRepository,
            SnapshotRepository snapshotRepository,
            RoomReplicaService replicaService,
            ObjectMapper objectMapper
    ) {
        this.operationLogRepository = operationLogRepository;
        this.snapshotRepository = snapshotRepository;
        this.replicaService = replicaService;
        this.objectMapper = objectMapper;
    }

    public void recordOperation(String roomId, String userId, String hlc, ShapeOperation op) {
        try {
            String opId = op.opId() == null || op.opId().isBlank()
                    ? UUID.randomUUID().toString()
                    : op.opId();
            if (operationLogRepository.existsById(opId)) {
                return;
            }

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
            operationLogRepository.save(entity);
        } catch (DataIntegrityViolationException ignored) {
            // Duplicate opId means a pending operation was replayed after reconnect; the first write wins.
        } catch (Exception ignored) {
            // Persistence is best-effort during early demo stages; realtime collaboration should keep flowing.
        }
    }

    @Scheduled(fixedRateString = "${history.snapshot-interval-ms:60000}")
    public void snapshotActiveRooms() {
        replicaService.roomIds().forEach(this::saveSnapshot);
    }

    public HistoryResponse history(String roomId, long at) {
        SnapshotEntity snapshot = snapshotRepository
                .findFirstByRoomIdAndCreatedAtLessThanEqualOrderByCreatedAtDesc(roomId, at)
                .orElseGet(() -> emptySnapshot(roomId));

        List<HistoryOp> ops = operationLogRepository
                .findByRoomIdAndCreatedAtGreaterThanAndCreatedAtLessThanEqualOrderByCreatedAtAsc(
                        roomId,
                        snapshot.getCreatedAt(),
                        at
                )
                .stream()
                .map(this::toHistoryOp)
                .toList();

        return new HistoryResponse(
                new HistorySnapshot(snapshot.getSnapshotId(), snapshot.getHlc(), snapshot.getCreatedAt(), snapshot.getPayload()),
                ops
        );
    }

    private void saveSnapshot(String roomId) {
        try {
            SnapshotEntity entity = new SnapshotEntity();
            entity.setSnapshotId(UUID.randomUUID().toString());
            entity.setRoomId(roomId);
            entity.setCreatedAt(System.currentTimeMillis());
            entity.setHlc("");
            entity.setPayload(objectMapper.writeValueAsString(replicaService.snapshot(roomId)));
            snapshotRepository.save(entity);
        } catch (Exception ignored) {
            // Snapshotting should never interrupt live collaboration.
        }
    }

    private SnapshotEntity emptySnapshot(String roomId) {
        SnapshotEntity entity = new SnapshotEntity();
        entity.setSnapshotId("empty-" + roomId);
        entity.setRoomId(roomId);
        entity.setHlc("");
        entity.setCreatedAt(0);
        entity.setPayload("[]");
        return entity;
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

    public record HistoryResponse(HistorySnapshot snapshot, List<HistoryOp> ops) {
    }

    public record HistorySnapshot(String snapshotId, String hlc, long createdAt, String payload) {
    }

    public record HistoryOp(String opId, String userId, String hlc, long createdAt, String payload) {
    }
}

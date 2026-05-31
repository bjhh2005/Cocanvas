package com.cocanvas.service;

import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.HashMap;

import com.cocanvas.crdt.HybridLogicalClock;
import com.cocanvas.protocol.common.ShapeOperation;
import org.springframework.stereotype.Service;

@Service
public class RoomReplicaService {

    private final HybridLogicalClock clock;
    private final Map<String, Map<String, ReplicatedShape>> rooms = new ConcurrentHashMap<>();

    public RoomReplicaService(HybridLogicalClock clock) {
        this.clock = clock;
    }

    public String apply(String roomId, String hlc, String userId, ShapeOperation op) {
        String mergedHlc = clock.update(hlc);
        applyMerged(roomId, mergedHlc, userId, op);
        return mergedHlc;
    }

    public String mergeHlc(String hlc) {
        return clock.update(hlc);
    }

    public void applyCommitted(String roomId, String mergedHlc, String userId, ShapeOperation op) {
        applyMerged(roomId, mergedHlc, userId, op);
    }

    public void applyRemote(String roomId, String mergedHlc, String userId, ShapeOperation op) {
        applyMerged(roomId, mergedHlc, userId, op);
    }

    private void applyMerged(String roomId, String mergedHlc, String userId, ShapeOperation op) {
        Map<String, ReplicatedShape> shapes = rooms.computeIfAbsent(roomId, key -> new ConcurrentHashMap<>());

        if ("delete".equals(op.opType())) {
            ReplicatedShape existing = shapes.get(op.shapeId());
            if (existing == null || shouldApply(mergedHlc, userId, existing.tombstoneHlc(), existing.tombstoneWriter())) {
                shapes.put(op.shapeId(), new ReplicatedShape(
                        existing == null ? op.shapeType() : existing.shapeType(),
                        existing == null ? new ConcurrentHashMap<>() : existing.attrs(),
                        mergedHlc,
                        userId
                ));
            }
            return;
        }

        shapes.compute(op.shapeId(), (shapeId, existing) -> {
            ReplicatedShape current = existing == null
                    ? new ReplicatedShape(op.shapeType(), new ConcurrentHashMap<>(), null, null)
                    : existing;

            if (current.tombstoneHlc() != null && !shouldApply(mergedHlc, userId, current.tombstoneHlc(), current.tombstoneWriter())) {
                return current;
            }

            if (op.attrs() == null) {
                return current;
            }

            op.attrs().forEach((key, value) -> {
                VersionedValue previous = current.attrs().get(key);
                if (previous == null || shouldApply(mergedHlc, userId, previous.hlc(), previous.writerId())) {
                    current.attrs().put(key, new VersionedValue(value, mergedHlc, userId));
                }
            });

            return current;
        });
    }

    public Set<String> roomIds() {
        return rooms.keySet();
    }

    public Map<String, Map<String, Object>> snapshot(String roomId) {
        Map<String, ReplicatedShape> shapes = rooms.getOrDefault(roomId, Map.of());
        // 返回值是一次性序列化用的临时结构，用 HashMap 避免 ConcurrentHashMap 的并发开销
        Map<String, Map<String, Object>> snapshot = new HashMap<>();
        shapes.forEach((shapeId, shape) -> {
            if (shape.tombstoneHlc() != null) {
                return;
            }

            Map<String, Object> attrs = new HashMap<>();
            shape.attrs().forEach((key, value) -> attrs.put(key, value.value()));
            attrs.put("shapeType", shape.shapeType());
            snapshot.put(shapeId, attrs);
        });
        return snapshot;
    }

    public Map<String, Map<String, Object>> versionedSnapshot(String roomId) {
        Map<String, ReplicatedShape> shapes = rooms.getOrDefault(roomId, Map.of());
        Map<String, Map<String, Object>> snapshot = new HashMap<>();
        shapes.forEach((shapeId, shape) -> {
            if (shape.tombstoneHlc() != null) {
                return;
            }

            Map<String, Object> attrs = new HashMap<>();
            shape.attrs().forEach((key, value) -> {
                Map<String, Object> versionedValue = new HashMap<>();
                versionedValue.put("value", value.value());
                versionedValue.put("hlc", value.hlc());
                versionedValue.put("writerId", value.writerId());
                attrs.put(key, versionedValue);
            });
            attrs.put("shapeType", shape.shapeType());
            snapshot.put(shapeId, attrs);
        });
        return snapshot;
    }

    private boolean shouldApply(String nextHlc, String nextWriter, String currentHlc, String currentWriter) {
        int hlcCompare = clock.compare(nextHlc, currentHlc);
        if (hlcCompare != 0) {
            return hlcCompare > 0;
        }

        return nextWriter.compareTo(currentWriter) >= 0;
    }

    private record ReplicatedShape(
            String shapeType,
            Map<String, VersionedValue> attrs,
            String tombstoneHlc,
            String tombstoneWriter
    ) {
    }

    private record VersionedValue(Object value, String hlc, String writerId) {
    }
}

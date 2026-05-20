package com.cocanvas.ws;

import com.cocanvas.protocol.Op;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.concurrent.ConcurrentHashMap;

/**
 * In-memory per-room shape state (Step 33).
 * Applies ops locally so late-joining clients can receive a full snapshot.
 * State is lost on server restart — persistence comes in Step 39-41.
 */
@Component
public class RoomShapeStore {

    private record ShapeState(String shapeType, ObjectNode attrs) {}

    // roomId -> shapeId -> ShapeState
    private final ConcurrentHashMap<String, ConcurrentHashMap<String, ShapeState>> rooms =
            new ConcurrentHashMap<>();

    private final ObjectMapper objectMapper;

    public RoomShapeStore(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    public void applyOp(String roomId, Op op) {
        var room = rooms.computeIfAbsent(roomId, k -> new ConcurrentHashMap<>());
        switch (op.opType()) {
            case "create" -> {
                ObjectNode attrsNode = op.attrs() instanceof ObjectNode on
                        ? on.deepCopy()
                        : objectMapper.createObjectNode();
                room.put(op.shapeId(), new ShapeState(op.shapeType(), attrsNode));
            }
            case "update" -> room.computeIfPresent(op.shapeId(), (k, existing) -> {
                if (op.attrs() instanceof ObjectNode updates) {
                    ObjectNode merged = existing.attrs().deepCopy();
                    updates.fields().forEachRemaining(e -> merged.set(e.getKey(), e.getValue()));
                    return new ShapeState(existing.shapeType(), merged);
                }
                return existing;
            });
            case "delete" -> room.remove(op.shapeId());
        }
    }

    /** Returns all current shapes as synthetic "create" ops for snapshot delivery. */
    public List<Op> getSnapshot(String roomId) {
        var room = rooms.get(roomId);
        if (room == null) return List.of();
        return room.entrySet().stream()
                .map(e -> new Op("create", e.getKey(), e.getValue().shapeType(), e.getValue().attrs()))
                .toList();
    }
}

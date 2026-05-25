package com.cocanvas.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

@Entity
@Table(
        name = "operation_logs",
        indexes = {
                @Index(name = "idx_operation_logs_room_hlc", columnList = "roomId,hlc"),
                @Index(name = "idx_operation_logs_room_created", columnList = "roomId,createdAt")
        }
)
public class OperationLogEntity {

    @Id
    private String opId;
    private String roomId;
    private String userId;
    private String opType;
    private String shapeId;
    private String shapeType;
    private String hlc;
    private long createdAt;

    @Column(columnDefinition = "TEXT")
    private String payload;

    public String getOpId() {
        return opId;
    }

    public void setOpId(String opId) {
        this.opId = opId;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
    }

    public String getUserId() {
        return userId;
    }

    public void setUserId(String userId) {
        this.userId = userId;
    }

    public String getOpType() {
        return opType;
    }

    public void setOpType(String opType) {
        this.opType = opType;
    }

    public String getShapeId() {
        return shapeId;
    }

    public void setShapeId(String shapeId) {
        this.shapeId = shapeId;
    }

    public String getShapeType() {
        return shapeType;
    }

    public void setShapeType(String shapeType) {
        this.shapeType = shapeType;
    }

    public String getHlc() {
        return hlc;
    }

    public void setHlc(String hlc) {
        this.hlc = hlc;
    }

    public long getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(long createdAt) {
        this.createdAt = createdAt;
    }

    public String getPayload() {
        return payload;
    }

    public void setPayload(String payload) {
        this.payload = payload;
    }
}

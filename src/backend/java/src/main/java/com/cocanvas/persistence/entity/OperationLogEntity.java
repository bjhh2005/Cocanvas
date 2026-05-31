package com.cocanvas.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;
import jakarta.persistence.Transient;
import org.springframework.data.domain.Persistable;

@Entity
@Table(
        name = "operation_logs",
        indexes = {
                @Index(name = "idx_operation_logs_room_hlc", columnList = "roomId,hlc"),
                @Index(name = "idx_operation_logs_room_created", columnList = "roomId,createdAt")
        }
)
public class OperationLogEntity implements Persistable<String> {

    @Id
    private String opId;
    private String roomId;
    private String userId;
    private String opType;
    private String shapeId;
    private String shapeType;
    private String hlc;
    private long createdAt;

    // LONGTEXT 而非 TEXT：单条 op（如包含大量点的 pen 笔迹）也可能超过 64KB，统一放宽避免截断。
    @Column(columnDefinition = "LONGTEXT")
    private String payload;

    // Persistable: opId 是外部分配的（客户端 opId 或 UUID），始终视为新插入，
    // 让 Spring Data 走 persist() 而非 merge()，从而避免每行先 SELECT、支持真正的 JDBC 批量插入。
    // 重复 opId 由数据库主键约束拦截，批量失败时回退逐条保存。
    @Override
    @Transient
    public String getId() {
        return opId;
    }

    @Override
    @Transient
    public boolean isNew() {
        return true;
    }

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

package com.cocanvas.persistence.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Index;
import jakarta.persistence.Table;

@Entity
@Table(
        name = "snapshots",
        indexes = {
                @Index(name = "idx_snapshots_room_created", columnList = "roomId,createdAt")
        }
)
public class SnapshotEntity {

    @Id
    private String snapshotId;
    private String roomId;
    private String hlc;
    private long createdAt;

    // LONGTEXT (最大 4GB) 而非 TEXT (64KB)：大白板的完整快照 JSON 极易超过 64KB，
    // 用 TEXT 会被 MySQL 静默截断导致快照损坏、历史恢复失败。
    @Column(columnDefinition = "LONGTEXT")
    private String payload;

    public String getSnapshotId() {
        return snapshotId;
    }

    public void setSnapshotId(String snapshotId) {
        this.snapshotId = snapshotId;
    }

    public String getRoomId() {
        return roomId;
    }

    public void setRoomId(String roomId) {
        this.roomId = roomId;
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

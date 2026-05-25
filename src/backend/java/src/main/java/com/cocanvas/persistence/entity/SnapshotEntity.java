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

    @Column(columnDefinition = "TEXT")
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

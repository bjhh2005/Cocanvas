package com.cocanvas.persistence.repository;

import java.util.List;
import java.util.Optional;

import com.cocanvas.persistence.entity.SnapshotEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface SnapshotRepository extends JpaRepository<SnapshotEntity, String> {

    Optional<SnapshotEntity> findFirstByRoomIdAndCreatedAtLessThanEqualOrderByCreatedAtDesc(String roomId, long at);

    /** All snapshot timestamps for a room, ascending — used to render the history timeline. */
    @Query("SELECT s.createdAt FROM SnapshotEntity s WHERE s.roomId = :roomId ORDER BY s.createdAt ASC")
    List<Long> findCreatedAtByRoomIdOrderByCreatedAtAsc(String roomId);

    /** Second-most-recent snapshot (used to determine safe op pruning boundary). */
    Optional<SnapshotEntity> findFirstByRoomIdAndCreatedAtLessThanOrderByCreatedAtDesc(String roomId, long before);
}

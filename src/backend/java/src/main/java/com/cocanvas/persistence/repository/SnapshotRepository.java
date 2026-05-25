package com.cocanvas.persistence.repository;

import java.util.Optional;

import com.cocanvas.persistence.entity.SnapshotEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SnapshotRepository extends JpaRepository<SnapshotEntity, String> {

    Optional<SnapshotEntity> findFirstByRoomIdAndCreatedAtLessThanEqualOrderByCreatedAtDesc(String roomId, long at);
}

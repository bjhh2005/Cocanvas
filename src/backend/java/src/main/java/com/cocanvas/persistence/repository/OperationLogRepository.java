package com.cocanvas.persistence.repository;

import java.util.List;
import java.util.Optional;

import com.cocanvas.persistence.entity.OperationLogEntity;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.transaction.annotation.Transactional;

public interface OperationLogRepository extends JpaRepository<OperationLogEntity, String> {

    List<OperationLogEntity> findByRoomIdAndCreatedAtGreaterThanAndCreatedAtLessThanEqualOrderByCreatedAtAsc(
            String roomId,
            long after,
            long at
    );

    List<OperationLogEntity> findByRoomIdAndCreatedAtGreaterThanEqualAndCreatedAtLessThanEqualOrderByCreatedAtAsc(
            String roomId,
            long after,
            long at
    );

    List<OperationLogEntity> findByRoomIdAndCreatedAtLessThanEqualOrderByCreatedAtAsc(
            String roomId,
            long at
    );

    /** Latest op timestamp for the room — used to set the right edge of the history timeline. */
    @Query("SELECT MAX(o.createdAt) FROM OperationLogEntity o WHERE o.roomId = :roomId")
    Optional<Long> findMaxCreatedAtByRoomId(String roomId);

    /** Delete ops that are fully covered by a snapshot — safe storage pruning. */
    @Modifying
    @Transactional
    @Query("DELETE FROM OperationLogEntity o WHERE o.roomId = :roomId AND o.createdAt < :before")
    int deleteByRoomIdAndCreatedAtBefore(String roomId, long before);
}

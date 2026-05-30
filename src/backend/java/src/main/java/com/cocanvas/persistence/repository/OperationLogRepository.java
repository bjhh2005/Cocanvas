package com.cocanvas.persistence.repository;

import java.util.List;

import com.cocanvas.persistence.entity.OperationLogEntity;
import org.springframework.data.jpa.repository.JpaRepository;

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
}

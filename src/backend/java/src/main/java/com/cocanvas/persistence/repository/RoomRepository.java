package com.cocanvas.persistence.repository;

import java.util.List;

import com.cocanvas.persistence.entity.RoomEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomRepository extends JpaRepository<RoomEntity, String> {

    List<RoomEntity> findByArchivedFalseOrderByUpdatedAtDesc();
}

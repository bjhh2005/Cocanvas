package com.cocanvas.persistence.repository;

import java.util.List;
import java.util.Optional;

import com.cocanvas.persistence.entity.RoomMemberEntity;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoomMemberRepository extends JpaRepository<RoomMemberEntity, Long> {

    List<RoomMemberEntity> findByRoomIdOrderByCreatedAtAsc(String roomId);

    Optional<RoomMemberEntity> findByRoomIdAndUserId(String roomId, String userId);

    long countByRoomId(String roomId);

    long countByRoomIdAndRole(String roomId, String role);

    void deleteByRoomIdAndUserId(String roomId, String userId);
}

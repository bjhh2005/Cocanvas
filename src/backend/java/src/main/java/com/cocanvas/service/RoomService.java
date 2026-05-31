package com.cocanvas.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import com.cocanvas.persistence.entity.RoomMemberEntity;
import com.cocanvas.persistence.entity.RoomEntity;
import com.cocanvas.persistence.entity.UserEntity;
import com.cocanvas.persistence.repository.RoomMemberRepository;
import com.cocanvas.persistence.repository.RoomRepository;
import com.cocanvas.persistence.repository.UserRepository;
import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class RoomService {

    private final RoomRepository roomRepository;
    private final RoomMemberRepository roomMemberRepository;
    private final UserRepository userRepository;

    // Caffeine cache: max 1000 rooms, 10 s TTL, stats recording enabled
    private final Cache<String, RoomEntity> roomCache = Caffeine.newBuilder()
            .maximumSize(1_000)
            .expireAfterWrite(10, TimeUnit.SECONDS)
            .recordStats()
            .build();

    public RoomService(RoomRepository roomRepository, RoomMemberRepository roomMemberRepository, UserRepository userRepository) {
        this.roomRepository = roomRepository;
        this.roomMemberRepository = roomMemberRepository;
        this.userRepository = userRepository;
    }

    /** Hit rate, miss rate, load count, etc. for observability. */
    public CacheStats cacheStats() {
        return roomCache.stats();
    }

    public List<RoomEntity> listActiveRooms() {
        return roomRepository.findByArchivedFalseOrderByUpdatedAtDesc();
    }

    @Transactional
    public RoomEntity createRoom(CreateRoomCommand command) {
        return createRoom(command, null);
    }

    @Transactional
    public RoomEntity createRoom(CreateRoomCommand command, AuthService.UserPrincipal creator) {
        long now = System.currentTimeMillis();
        RoomEntity room = new RoomEntity();
        room.setRoomId(uniqueRoomId(command.roomId()));
        room.setName(cleanName(command.name(), room.getRoomId()));
        room.setAccessMode(cleanMode(command.accessMode(), "link"));
        room.setPermissionMode(cleanMode(command.permissionMode(), "edit"));
        room.setVoiceEnabled(command.voiceEnabled());
        room.setArchived(false);
        room.setPasswordHash(hashPassword(command.password()));
        room.setCreatedAt(now);
        room.setUpdatedAt(now);
        RoomEntity saved = roomRepository.save(room);
        if (creator != null) {
            upsertMemberInternal(saved.getRoomId(), creator.userId(), "owner", creator.userId(), now);
        }
        evictRoom(saved.getRoomId());
        return saved;
    }

    public Optional<RoomEntity> findRoom(String roomId) {
        RoomEntity cached = roomCache.getIfPresent(roomId);
        if (cached != null) {
            return cached.isArchived() ? Optional.empty() : Optional.of(cached);
        }

        Optional<RoomEntity> room = roomRepository.findById(roomId).filter(r -> !r.isArchived());
        room.ifPresent(entity -> roomCache.put(roomId, entity));
        return room;
    }

    public RoomEntity updateRoom(String roomId, UpdateRoomCommand command) {
        RoomEntity room = roomRepository.findById(roomId).orElseThrow(() -> new RoomNotFoundException(roomId));
        if (room.isArchived()) {
            throw new RoomNotFoundException(roomId);
        }

        room.setName(cleanName(command.name(), room.getRoomId()));
        room.setAccessMode(cleanMode(command.accessMode(), room.getAccessMode()));
        room.setPermissionMode(cleanMode(command.permissionMode(), room.getPermissionMode()));
        room.setVoiceEnabled(command.voiceEnabled());
        if (command.password() != null) {
            room.setPasswordHash(hashPassword(command.password()));
        }
        room.setUpdatedAt(System.currentTimeMillis());
        RoomEntity saved = roomRepository.save(room);
        evictRoom(roomId);
        return saved;
    }

    public void archiveRoom(String roomId) {
        RoomEntity room = roomRepository.findById(roomId).orElseThrow(() -> new RoomNotFoundException(roomId));
        room.setArchived(true);
        room.setUpdatedAt(System.currentTimeMillis());
        roomRepository.save(room);
        evictRoom(roomId);
    }

    public boolean canEnter(RoomEntity room, String password) {
        if (room.getPasswordHash() == null || room.getPasswordHash().isBlank()) {
            return true;
        }

        return room.getPasswordHash().equals(hashPassword(password));
    }

    public EffectiveAccess effectiveAccess(RoomEntity room, AuthService.UserPrincipal principal) {
        if (principal == null) {
            return new EffectiveAccess(cleanMode(room.getPermissionMode(), "edit"), "");
        }

        return roomMemberRepository.findByRoomIdAndUserId(room.getRoomId(), principal.userId())
                .map(member -> new EffectiveAccess(permissionForRole(member.getRole()), cleanRole(member.getRole())))
                .orElseGet(() -> new EffectiveAccess(cleanMode(room.getPermissionMode(), "edit"), ""));
    }

    public boolean canWrite(String permissionMode, String opType, String shapeType) {
        String mode = cleanMode(permissionMode, "edit");
        if ("view".equals(mode)) {
            return false;
        }

        if ("comment".equals(mode)) {
            return "comment".equals(shapeType);
        }

        return true;
    }

    public boolean canManageMembers(String roomId, AuthService.UserPrincipal principal) {
        if (principal == null) {
            return false;
        }
        long memberCount = roomMemberRepository.countByRoomId(roomId);
        if (memberCount == 0) {
            return true;
        }

        return roomMemberRepository.findByRoomIdAndUserId(roomId, principal.userId())
                .map(member -> "owner".equals(cleanRole(member.getRole())))
                .orElse(false);
    }

    public List<RoomMemberView> listMembers(String roomId) {
        if (findRoom(roomId).isEmpty()) {
            throw new RoomNotFoundException(roomId);
        }

        List<RoomMemberEntity> roomMembers = roomMemberRepository.findByRoomIdOrderByCreatedAtAsc(roomId);
        Map<String, UserEntity> usersById = userRepository.findAllById(
                        roomMembers.stream()
                                .map(RoomMemberEntity::getUserId)
                                .toList()
                ).stream()
                .collect(java.util.stream.Collectors.toMap(UserEntity::getUserId, user -> user));

        return roomMembers.stream()
                .map(member -> {
                    UserEntity user = usersById.get(member.getUserId());
                    return new RoomMemberView(
                            member.getUserId(),
                            user == null ? "" : user.getUsername(),
                            user == null ? member.getUserId() : user.getDisplayName(),
                            user == null ? "#3772ff" : user.getColor(),
                            cleanRole(member.getRole()),
                            member.getUpdatedAt()
                    );
                })
                .toList();
    }

    @Transactional
    public RoomMemberView claimOwner(String roomId, AuthService.UserPrincipal principal) {
        if (principal == null) {
            throw new MemberAccessDeniedException("请先登录再认领房间");
        }
        if (findRoom(roomId).isEmpty()) {
            throw new RoomNotFoundException(roomId);
        }
        if (roomMemberRepository.countByRoomId(roomId) > 0) {
            throw new MemberAccessDeniedException("房间已有成员管理员");
        }

        RoomMemberEntity member = upsertMemberInternal(roomId, principal.userId(), "owner", principal.userId(), System.currentTimeMillis());
        return toMemberView(member);
    }

    @Transactional
    public RoomMemberView upsertMember(String roomId, String targetUserId, String role, AuthService.UserPrincipal actor) {
        if (findRoom(roomId).isEmpty()) {
            throw new RoomNotFoundException(roomId);
        }
        if (!canManageMembers(roomId, actor)) {
            throw new MemberAccessDeniedException("只有房间 owner 可以管理成员");
        }
        if (userRepository.findById(targetUserId).isEmpty()) {
            throw new MemberAccessDeniedException("目标用户不存在，请先让对方登录一次");
        }

        String cleanedRole = cleanRole(role);
        guardOwnerRoleChange(roomId, targetUserId, cleanedRole, actor);
        RoomMemberEntity member = upsertMemberInternal(roomId, targetUserId, cleanedRole, actor.userId(), System.currentTimeMillis());
        return toMemberView(member);
    }

    @Transactional
    public void removeMember(String roomId, String targetUserId, AuthService.UserPrincipal actor) {
        if (findRoom(roomId).isEmpty()) {
            throw new RoomNotFoundException(roomId);
        }
        if (!canManageMembers(roomId, actor)) {
            throw new MemberAccessDeniedException("只有房间 owner 可以管理成员");
        }
        if (actor.userId().equals(targetUserId)) {
            throw new MemberAccessDeniedException("不能移除自己");
        }
        roomMemberRepository.findByRoomIdAndUserId(roomId, targetUserId)
                .filter(member -> "owner".equals(cleanRole(member.getRole())))
                .ifPresent(member -> {
                    if (roomMemberRepository.countByRoomIdAndRole(roomId, "owner") <= 1) {
                        throw new MemberAccessDeniedException("房间至少需要保留一个 owner");
                    }
                });
        roomMemberRepository.deleteByRoomIdAndUserId(roomId, targetUserId);
    }

    public Optional<UserEntity> findUserByUsername(String username) {
        return userRepository.findByUsername(cleanUsername(username));
    }

    public void evictRoom(String roomId) {
        roomCache.invalidate(roomId);
    }

    private String uniqueRoomId(String requestedRoomId) {
        String cleaned = cleanRoomId(requestedRoomId);
        if (!cleaned.isBlank() && roomRepository.findById(cleaned).isEmpty()) {
            return cleaned;
        }

        String generated;
        do {
            generated = UUID.randomUUID().toString().substring(0, 8);
        } while (roomRepository.findById(generated).isPresent());
        return generated;
    }

    private String cleanRoomId(String roomId) {
        if (roomId == null) {
            return "";
        }

        return roomId.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9-_]", "-");
    }

    private String cleanName(String name, String fallbackRoomId) {
        if (name == null || name.isBlank()) {
            return "Cocanvas " + fallbackRoomId;
        }

        return name.trim();
    }

    private String cleanMode(String value, String fallback) {
        if (value == null || value.isBlank()) {
            return fallback;
        }

        return value.trim().toLowerCase(Locale.ROOT);
    }

    private String cleanUsername(String username) {
        if (username == null) {
            return "";
        }
        return username.trim().toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9_.-]", "");
    }

    private String cleanRole(String role) {
        String cleaned = cleanMode(role, "view");
        if ("owner".equals(cleaned) || "edit".equals(cleaned) || "comment".equals(cleaned) || "view".equals(cleaned)) {
            return cleaned;
        }
        return "view";
    }

    private String permissionForRole(String role) {
        String cleaned = cleanRole(role);
        if ("owner".equals(cleaned)) {
            return "edit";
        }
        return cleaned;
    }

    private void guardOwnerRoleChange(String roomId, String targetUserId, String nextRole, AuthService.UserPrincipal actor) {
        if ("owner".equals(nextRole)) {
            return;
        }

        roomMemberRepository.findByRoomIdAndUserId(roomId, targetUserId)
                .filter(member -> "owner".equals(cleanRole(member.getRole())))
                .ifPresent(member -> {
                    if (actor != null && actor.userId().equals(targetUserId)) {
                        throw new MemberAccessDeniedException("不能降级自己的 owner 权限");
                    }
                    if (roomMemberRepository.countByRoomIdAndRole(roomId, "owner") <= 1) {
                        throw new MemberAccessDeniedException("房间至少需要保留一个 owner");
                    }
                });
    }

    private RoomMemberEntity upsertMemberInternal(String roomId, String userId, String role, String actorUserId, long now) {
        RoomMemberEntity member = roomMemberRepository.findByRoomIdAndUserId(roomId, userId).orElseGet(() -> {
            RoomMemberEntity created = new RoomMemberEntity();
            created.setRoomId(roomId);
            created.setUserId(userId);
            created.setCreatedAt(now);
            return created;
        });
        member.setRole(cleanRole(role));
        member.setInvitedByUserId(actorUserId);
        member.setUpdatedAt(now);
        return roomMemberRepository.save(member);
    }

    private RoomMemberView toMemberView(RoomMemberEntity member) {
        UserEntity user = userRepository.findById(member.getUserId()).orElse(null);
        return new RoomMemberView(
                member.getUserId(),
                user == null ? "" : user.getUsername(),
                user == null ? member.getUserId() : user.getDisplayName(),
                user == null ? "#3772ff" : user.getColor(),
                cleanRole(member.getRole()),
                member.getUpdatedAt()
        );
    }

    private String hashPassword(String password) {
        if (password == null || password.isBlank()) {
            return null;
        }

        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashed = digest.digest(password.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hashed);
        } catch (NoSuchAlgorithmException ex) {
            throw new IllegalStateException("SHA-256 is not available", ex);
        }
    }

    public record CreateRoomCommand(
            String roomId,
            String name,
            String accessMode,
            String permissionMode,
            String password,
            boolean voiceEnabled
    ) {
    }

    public record UpdateRoomCommand(
            String name,
            String accessMode,
            String permissionMode,
            String password,
            boolean voiceEnabled
    ) {
    }

    public record EffectiveAccess(String permissionMode, String memberRole) {
    }

    public record RoomMemberView(
            String userId,
            String username,
            String displayName,
            String color,
            String role,
            long updatedAt
    ) {
    }

    public static class MemberAccessDeniedException extends RuntimeException {
        public MemberAccessDeniedException(String message) {
            super(message);
        }
    }

    public static class RoomNotFoundException extends RuntimeException {
        public RoomNotFoundException(String roomId) {
            super("Room not found: " + roomId);
        }
    }

}

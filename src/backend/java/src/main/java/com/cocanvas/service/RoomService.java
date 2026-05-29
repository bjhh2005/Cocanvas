package com.cocanvas.service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;

import com.cocanvas.persistence.entity.RoomEntity;
import com.cocanvas.persistence.repository.RoomRepository;
import org.springframework.stereotype.Service;

@Service
public class RoomService {

    private final RoomRepository roomRepository;

    public RoomService(RoomRepository roomRepository) {
        this.roomRepository = roomRepository;
    }

    public List<RoomEntity> listActiveRooms() {
        return roomRepository.findByArchivedFalseOrderByUpdatedAtDesc();
    }

    public RoomEntity createRoom(CreateRoomCommand command) {
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
        return roomRepository.save(room);
    }

    public Optional<RoomEntity> findRoom(String roomId) {
        return roomRepository.findById(roomId).filter(room -> !room.isArchived());
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
        return roomRepository.save(room);
    }

    public void archiveRoom(String roomId) {
        RoomEntity room = roomRepository.findById(roomId).orElseThrow(() -> new RoomNotFoundException(roomId));
        room.setArchived(true);
        room.setUpdatedAt(System.currentTimeMillis());
        roomRepository.save(room);
    }

    public boolean canEnter(RoomEntity room, String password) {
        if (room.getPasswordHash() == null || room.getPasswordHash().isBlank()) {
            return true;
        }

        return room.getPasswordHash().equals(hashPassword(password));
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

    public static class RoomNotFoundException extends RuntimeException {
        public RoomNotFoundException(String roomId) {
            super("Room not found: " + roomId);
        }
    }
}

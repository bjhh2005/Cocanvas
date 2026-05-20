package com.cocanvas.controller;

import java.util.UUID;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

// Nginx 已剥离 /api/ 前缀，这里直接映射到 /rooms
@RestController
@RequestMapping("/rooms")
public class RoomController {

    private static final String WS_URL = "ws://localhost:8080/ws/collab";

    public record RoomResponse(String roomId, String wsUrl) {}
    public record RoomQueryResponse(String roomId, boolean exists, String wsUrl) {}

    @PostMapping
    public RoomResponse createRoom() {
        String roomId = UUID.randomUUID().toString().substring(0, 8);
        return new RoomResponse(roomId, WS_URL);
    }

    @GetMapping("/{roomId}")
    public RoomQueryResponse getRoom(@PathVariable String roomId) {
        return new RoomQueryResponse(roomId, true, WS_URL);
    }
}

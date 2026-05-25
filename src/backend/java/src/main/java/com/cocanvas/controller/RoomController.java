package com.cocanvas.controller;

import java.util.UUID;

import com.cocanvas.cluster.NodeInfo;
import com.cocanvas.routing.NodeRouter;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RoomController {

    private final NodeRouter nodeRouter;

    public RoomController(NodeRouter nodeRouter) {
        this.nodeRouter = nodeRouter;
    }

    @PostMapping({"/api/rooms", "/rooms"})
    public CreateRoomResponse createRoom() {
        String roomId = UUID.randomUUID().toString().substring(0, 8);
        return new CreateRoomResponse(roomId, wsUrl(roomId), System.currentTimeMillis());
    }

    @GetMapping({"/api/rooms/{roomId}", "/rooms/{roomId}"})
    public QueryRoomResponse getRoom(@PathVariable String roomId) {
        return new QueryRoomResponse(roomId, true, wsUrl(roomId));
    }

    private String wsUrl(String roomId) {
        NodeInfo node = nodeRouter.routeRoom(roomId);
        int port = node.port();
        String host = node.host();
        if (port == 80) {
            return "ws://" + host + "/ws/collab";
        }

        return "ws://" + host + ":" + port + "/ws/collab";
    }

    public record CreateRoomResponse(String roomId, String wsUrl, long createdAt) {
    }

    public record QueryRoomResponse(String roomId, boolean exists, String wsUrl) {
    }
}

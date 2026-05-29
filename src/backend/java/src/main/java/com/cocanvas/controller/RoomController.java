package com.cocanvas.controller;

import java.util.List;

import com.cocanvas.cluster.NodeInfo;
import com.cocanvas.persistence.entity.RoomEntity;
import com.cocanvas.routing.NodeRouter;
import com.cocanvas.service.RoomService;
import com.cocanvas.service.RoomService.CreateRoomCommand;
import com.cocanvas.service.RoomService.RoomNotFoundException;
import com.cocanvas.service.RoomService.UpdateRoomCommand;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RoomController {

    private final NodeRouter nodeRouter;
    private final RoomService roomService;

    public RoomController(NodeRouter nodeRouter, RoomService roomService) {
        this.nodeRouter = nodeRouter;
        this.roomService = roomService;
    }

    @GetMapping({"/api/rooms", "/rooms"})
    public List<RoomSummaryResponse> listRooms() {
        return roomService.listActiveRooms().stream()
                .map(this::toSummary)
                .toList();
    }

    @PostMapping({"/api/rooms", "/rooms"})
    public CreateRoomResponse createRoom(@RequestBody(required = false) CreateRoomRequest request) {
        CreateRoomRequest body = request == null ? new CreateRoomRequest(null, null, null, null, null, false) : request;
        RoomEntity room = roomService.createRoom(new CreateRoomCommand(
                body.roomId(),
                body.name(),
                body.accessMode(),
                body.permissionMode(),
                body.password(),
                body.voiceEnabled()
        ));
        return toCreateResponse(room);
    }

    @GetMapping({"/api/rooms/{roomId}", "/rooms/{roomId}"})
    public QueryRoomResponse getRoom(
            @PathVariable String roomId,
            @RequestParam(required = false) String password
    ) {
        return roomService.findRoom(roomId)
                .map(room -> toQueryResponse(room, roomService.canEnter(room, password)))
                .orElseGet(() -> QueryRoomResponse.missing(roomId));
    }

    @PutMapping({"/api/rooms/{roomId}", "/rooms/{roomId}"})
    public RoomSummaryResponse updateRoom(
            @PathVariable String roomId,
            @RequestBody UpdateRoomRequest request
    ) {
        RoomEntity room = roomService.updateRoom(roomId, new UpdateRoomCommand(
                request.name(),
                request.accessMode(),
                request.permissionMode(),
                request.password(),
                request.voiceEnabled()
        ));
        return toSummary(room);
    }

    @DeleteMapping({"/api/rooms/{roomId}", "/rooms/{roomId}"})
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void archiveRoom(@PathVariable String roomId) {
        roomService.archiveRoom(roomId);
    }

    @ExceptionHandler(RoomNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse handleRoomNotFound(RoomNotFoundException ex) {
        return new ErrorResponse(ex.getMessage());
    }

    private CreateRoomResponse toCreateResponse(RoomEntity room) {
        return new CreateRoomResponse(
                room.getRoomId(),
                room.getName(),
                wsUrl(room.getRoomId()),
                room.getCreatedAt(),
                room.getAccessMode(),
                room.getPermissionMode(),
                room.getPasswordHash() != null,
                room.isVoiceEnabled()
        );
    }

    private QueryRoomResponse toQueryResponse(RoomEntity room, boolean authorized) {
        return new QueryRoomResponse(
                room.getRoomId(),
                true,
                authorized,
                authorized ? wsUrl(room.getRoomId()) : "",
                room.getName(),
                room.getCreatedAt(),
                room.getUpdatedAt(),
                room.getAccessMode(),
                room.getPermissionMode(),
                room.getPasswordHash() != null,
                room.isVoiceEnabled()
        );
    }

    private RoomSummaryResponse toSummary(RoomEntity room) {
        return new RoomSummaryResponse(
                room.getRoomId(),
                room.getName(),
                room.getCreatedAt(),
                room.getUpdatedAt(),
                room.getAccessMode(),
                room.getPermissionMode(),
                room.getPasswordHash() != null,
                room.isVoiceEnabled()
        );
    }

    private String wsUrl(String roomId) {
        NodeInfo node = nodeRouter.routeRoom(roomId);
        int port = node.port();
        String host = node.host();
        String path = normalizeWsPath(node.wsPath());
        if (port == 80) {
            return "ws://" + host + path;
        }

        return "ws://" + host + ":" + port + path;
    }

    private String normalizeWsPath(String wsPath) {
        if (wsPath == null || wsPath.isBlank()) {
            return "/ws/collab";
        }

        return wsPath.startsWith("/") ? wsPath : "/" + wsPath;
    }

    public record CreateRoomRequest(
            String roomId,
            String name,
            String accessMode,
            String permissionMode,
            String password,
            boolean voiceEnabled
    ) {
    }

    public record UpdateRoomRequest(
            String name,
            String accessMode,
            String permissionMode,
            String password,
            boolean voiceEnabled
    ) {
    }

    public record CreateRoomResponse(
            String roomId,
            String name,
            String wsUrl,
            long createdAt,
            String accessMode,
            String permissionMode,
            boolean passwordProtected,
            boolean voiceEnabled
    ) {
    }

    public record QueryRoomResponse(
            String roomId,
            boolean exists,
            boolean authorized,
            String wsUrl,
            String name,
            long createdAt,
            long updatedAt,
            String accessMode,
            String permissionMode,
            boolean passwordProtected,
            boolean voiceEnabled
    ) {
        public static QueryRoomResponse missing(String roomId) {
            return new QueryRoomResponse(roomId, false, false, "", "", 0, 0, "", "", false, false);
        }
    }

    public record RoomSummaryResponse(
            String roomId,
            String name,
            long createdAt,
            long updatedAt,
            String accessMode,
            String permissionMode,
            boolean passwordProtected,
            boolean voiceEnabled
    ) {
    }

    public record ErrorResponse(String message) {
    }
}

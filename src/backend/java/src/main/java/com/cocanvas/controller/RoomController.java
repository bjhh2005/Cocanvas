package com.cocanvas.controller;

import java.util.List;

import com.cocanvas.cluster.NodeInfo;
import com.cocanvas.persistence.entity.RoomEntity;
import com.cocanvas.protocol.outbound.RoomMembersBroadcastMessage;
import com.cocanvas.pubsub.RealtimeBroadcaster;
import com.cocanvas.routing.NodeRouter;
import com.cocanvas.service.AuthService;
import com.cocanvas.service.JoinTokenService;
import com.cocanvas.service.RoomService;
import com.cocanvas.service.RoomService.CreateRoomCommand;
import com.cocanvas.service.RoomService.MemberAccessDeniedException;
import com.cocanvas.service.RoomService.RoomMemberView;
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
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class RoomController {

    private final NodeRouter nodeRouter;
    private final JoinTokenService joinTokenService;
    private final RoomService roomService;
    private final AuthService authService;
    private final RealtimeBroadcaster broadcaster;

    public RoomController(NodeRouter nodeRouter, JoinTokenService joinTokenService, RoomService roomService,
                          AuthService authService, RealtimeBroadcaster broadcaster) {
        this.nodeRouter = nodeRouter;
        this.joinTokenService = joinTokenService;
        this.roomService = roomService;
        this.authService = authService;
        this.broadcaster = broadcaster;
    }

    /** 成员/角色变化后，通知房间内所有客户端刷新自身权限与成员列表。 */
    private void notifyMembersChanged(String roomId) {
        try {
            broadcaster.broadcast(roomId, new RoomMembersBroadcastMessage(roomId), null);
        } catch (Exception ignored) {
            // 广播失败不影响成员操作结果
        }
    }

    @GetMapping({"/api/rooms", "/rooms"})
    public List<RoomSummaryResponse> listRooms() {
        return roomService.listActiveRooms().stream()
                .map(this::toSummary)
                .toList();
    }

    @PostMapping({"/api/rooms", "/rooms"})
    public CreateRoomResponse createRoom(
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) CreateRoomRequest request
    ) {
        CreateRoomRequest body = request == null ? new CreateRoomRequest(null, null, null, null, null, false) : request;
        var principal = authService.authenticateHeader(authorization).orElse(null);
        RoomEntity room = roomService.createRoom(new CreateRoomCommand(
                body.roomId(),
                body.name(),
                body.accessMode(),
                body.permissionMode(),
                body.password(),
                body.voiceEnabled()
        ), principal);
        return toCreateResponse(room, principal);
    }

    @GetMapping({"/api/rooms/{roomId}", "/rooms/{roomId}"})
    public QueryRoomResponse getRoom(
            @PathVariable String roomId,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestParam(required = false) String password
    ) {
        var principal = authService.authenticateHeader(authorization).orElse(null);
        return roomService.findRoom(roomId)
                .map(room -> toQueryResponse(room, principal, roomService.canEnter(room, password)))
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

    @GetMapping({"/api/rooms/{roomId}/members", "/rooms/{roomId}/members"})
    public List<RoomMemberResponse> listMembers(@PathVariable String roomId) {
        return roomService.listMembers(roomId).stream()
                .map(this::toMemberResponse)
                .toList();
    }

    @PostMapping({"/api/rooms/{roomId}/members/claim", "/rooms/{roomId}/members/claim"})
    public RoomMemberResponse claimOwner(
            @PathVariable String roomId,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        RoomMemberView member = roomService.claimOwner(roomId, authService.authenticateHeader(authorization).orElse(null));
        notifyMembersChanged(roomId);
        return toMemberResponse(member);
    }

    @PutMapping({"/api/rooms/{roomId}/members", "/rooms/{roomId}/members"})
    public RoomMemberResponse upsertMember(
            @PathVariable String roomId,
            @RequestHeader(value = "Authorization", required = false) String authorization,
            @RequestBody(required = false) MemberUpsertRequest request
    ) {
        MemberUpsertRequest body = request == null ? new MemberUpsertRequest(null, null, null) : request;
        String targetUserId = body.userId();
        if ((targetUserId == null || targetUserId.isBlank()) && body.username() != null) {
            targetUserId = roomService.findUserByUsername(body.username())
                    .orElseThrow(() -> new MemberAccessDeniedException("目标用户不存在，请先让对方登录一次"))
                    .getUserId();
        }
        if (targetUserId == null || targetUserId.isBlank()) {
            throw new MemberAccessDeniedException("请提供用户名或用户 ID");
        }

        RoomMemberView member = roomService.upsertMember(
                roomId,
                targetUserId,
                body.role(),
                authService.authenticateHeader(authorization).orElse(null)
        );
        notifyMembersChanged(roomId);
        return toMemberResponse(member);
    }

    @DeleteMapping({"/api/rooms/{roomId}/members/{userId}", "/rooms/{roomId}/members/{userId}"})
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeMember(
            @PathVariable String roomId,
            @PathVariable String userId,
            @RequestHeader(value = "Authorization", required = false) String authorization
    ) {
        roomService.removeMember(roomId, userId, authService.authenticateHeader(authorization).orElse(null));
        notifyMembersChanged(roomId);
    }

    @ExceptionHandler(RoomNotFoundException.class)
    @ResponseStatus(HttpStatus.NOT_FOUND)
    public ErrorResponse handleRoomNotFound(RoomNotFoundException ex) {
        return new ErrorResponse(ex.getMessage());
    }

    @ExceptionHandler(MemberAccessDeniedException.class)
    @ResponseStatus(HttpStatus.FORBIDDEN)
    public ErrorResponse handleMemberAccess(MemberAccessDeniedException ex) {
        return new ErrorResponse(ex.getMessage());
    }

    private CreateRoomResponse toCreateResponse(RoomEntity room, AuthService.UserPrincipal principal) {
        var access = roomService.effectiveAccess(room, principal);
        return new CreateRoomResponse(
                room.getRoomId(),
                room.getName(),
                wsUrl(room.getRoomId()),
                room.getCreatedAt(),
                room.getAccessMode(),
                room.getPermissionMode(),
                room.getPasswordHash() != null,
                room.isVoiceEnabled(),
                joinTokenService.issue(room.getRoomId(), access.permissionMode()),
                access.memberRole()
        );
    }

    private QueryRoomResponse toQueryResponse(RoomEntity room, AuthService.UserPrincipal principal, boolean passwordAuthorized) {
        var access = roomService.effectiveAccess(room, principal);
        boolean memberAuthorized = !access.memberRole().isBlank();
        boolean authorized = memberAuthorized || passwordAuthorized;
        // 授权进入但尚未登记的登录用户 → 按房间默认权限自动成为成员，便于 owner 在成员列表中管理
        if (authorized && principal != null && !memberAuthorized && roomService.ensureMember(room, principal)) {
            access = roomService.effectiveAccess(room, principal);
            memberAuthorized = !access.memberRole().isBlank();
        }
        String effectivePermissionMode = authorized ? access.permissionMode() : room.getPermissionMode();
        String token = authorized ? joinTokenService.issue(room.getRoomId(), effectivePermissionMode) : "";
        return new QueryRoomResponse(
                room.getRoomId(),
                true,
                authorized,
                authorized ? wsUrl(room.getRoomId()) : "",
                room.getName(),
                room.getCreatedAt(),
                room.getUpdatedAt(),
                room.getAccessMode(),
                effectivePermissionMode,
                room.getPasswordHash() != null,
                room.isVoiceEnabled(),
                token,
                access.memberRole()
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
            boolean voiceEnabled,
            String joinToken,
            String memberRole
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
            boolean voiceEnabled,
            String joinToken,
            String memberRole
    ) {
        public static QueryRoomResponse missing(String roomId) {
            return new QueryRoomResponse(roomId, false, false, "", "", 0, 0, "", "", false, false, "", "");
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

    public record MemberUpsertRequest(String username, String userId, String role) {
    }

    public record RoomMemberResponse(
            String userId,
            String username,
            String displayName,
            String color,
            String role,
            long updatedAt
    ) {
    }

    public record ErrorResponse(String message) {
    }

    private RoomMemberResponse toMemberResponse(RoomMemberView member) {
        return new RoomMemberResponse(
                member.userId(),
                member.username(),
                member.displayName(),
                member.color(),
                member.role(),
                member.updatedAt()
        );
    }
}

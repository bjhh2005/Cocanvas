package com.cocanvas.protocol.outbound;

/**
 * 通知房间内所有客户端：成员/角色发生变化，请重新拉取自身权限与成员列表。
 */
public record RoomMembersBroadcastMessage(String type, String roomId) {
    public RoomMembersBroadcastMessage(String roomId) {
        this("room-members", roomId);
    }
}

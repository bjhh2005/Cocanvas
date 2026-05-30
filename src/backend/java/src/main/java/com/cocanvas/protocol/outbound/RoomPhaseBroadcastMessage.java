package com.cocanvas.protocol.outbound;

public record RoomPhaseBroadcastMessage(
        String type,
        String userId,
        String phaseId
) {
    public RoomPhaseBroadcastMessage(String userId, String phaseId) {
        this("room-phase", userId, phaseId);
    }
}

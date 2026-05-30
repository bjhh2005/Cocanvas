package com.cocanvas.protocol.outbound;

public record RoomEmojiBroadcastMessage(
        String type,
        String userId,
        String emoji
) {
    public RoomEmojiBroadcastMessage(String userId, String emoji) {
        this("room-emoji", userId, emoji);
    }
}

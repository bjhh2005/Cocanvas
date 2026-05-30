package com.cocanvas.protocol.outbound;

public record RoomChatBroadcastMessage(
        String type,
        String userId,
        String displayName,
        String color,
        String text,
        long timestamp
) {
    public RoomChatBroadcastMessage(String userId, String displayName, String color, String text, long timestamp) {
        this("room-chat", userId, displayName, color, text, timestamp);
    }
}

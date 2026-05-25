package com.cocanvas.protocol.outbound;

public record CursorBroadcastMessage(
        String type,
        String userId,
        String displayName,
        String color,
        double x,
        double y
) {

    public CursorBroadcastMessage(String userId, double x, double y) {
        this("cursor", userId, null, null, x, y);
    }

    public CursorBroadcastMessage(String userId, String displayName, String color, double x, double y) {
        this("cursor", userId, displayName, color, x, y);
    }
}

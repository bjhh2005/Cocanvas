package com.cocanvas.protocol.inbound;

public record RoomChatMessage(
        String msgId,
        String roomId,
        String userId,
        String displayName,
        String color,
        String text,
        long timestamp
) implements InboundMessage {
}

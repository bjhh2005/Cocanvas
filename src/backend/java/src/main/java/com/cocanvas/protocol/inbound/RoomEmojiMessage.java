package com.cocanvas.protocol.inbound;

public record RoomEmojiMessage(
        String msgId,
        String roomId,
        String userId,
        String emoji
) implements InboundMessage {
}

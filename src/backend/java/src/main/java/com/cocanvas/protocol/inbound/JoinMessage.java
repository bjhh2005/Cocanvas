package com.cocanvas.protocol.inbound;

public record JoinMessage(
        String msgId,
        String roomId,
        String userId,
        String displayName,
        String color
) implements InboundMessage {
}

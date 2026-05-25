package com.cocanvas.protocol.inbound;

public record CursorMessage(
        String msgId,
        String roomId,
        String userId,
        double x,
        double y
) implements InboundMessage {
}

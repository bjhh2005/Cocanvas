package com.cocanvas.protocol.inbound;

public record RoomPhaseMessage(
        String msgId,
        String roomId,
        String userId,
        String phaseId
) implements InboundMessage {
}

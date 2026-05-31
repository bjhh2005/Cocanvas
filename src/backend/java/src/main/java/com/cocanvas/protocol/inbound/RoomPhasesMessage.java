package com.cocanvas.protocol.inbound;

import java.util.List;
import java.util.Map;

public record RoomPhasesMessage(
        String msgId,
        String roomId,
        String userId,
        List<Map<String, String>> phases
) implements InboundMessage {
}

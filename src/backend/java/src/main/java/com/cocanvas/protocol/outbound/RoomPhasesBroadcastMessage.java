package com.cocanvas.protocol.outbound;

import java.util.List;
import java.util.Map;

public record RoomPhasesBroadcastMessage(
        String type,
        String userId,
        List<Map<String, String>> phases
) {
    public RoomPhasesBroadcastMessage(String userId, List<Map<String, String>> phases) {
        this("room-phases", userId, phases);
    }
}

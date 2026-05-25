package com.cocanvas.pubsub;

public record RoomBroadcastEvent(String roomId, String payload, String originNodeId) {
}

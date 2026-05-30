package com.cocanvas.pubsub;

import java.io.IOException;

import com.cocanvas.ws.RoomSessionRegistry;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

@Component
@ConditionalOnProperty(name = "realtime.broadcaster", havingValue = "local", matchIfMissing = true)
public class LocalRealtimeBroadcaster implements RealtimeBroadcaster {

    private final RoomSessionRegistry registry;
    private final ObjectMapper objectMapper;

    public LocalRealtimeBroadcaster(RoomSessionRegistry registry, ObjectMapper objectMapper) {
        this.registry = registry;
        this.objectMapper = objectMapper;
    }

    @Override
    public void broadcast(String roomId, Object outbound, WebSocketSession exceptSession) throws IOException {
        registry.broadcastInRoom(roomId, objectMapper.writeValueAsString(outbound), exceptSession);
    }

    @Override
    public void broadcastTransient(String roomId, Object outbound, WebSocketSession exceptSession) throws IOException {
        registry.broadcastTransientInRoom(roomId, objectMapper.writeValueAsString(outbound), exceptSession);
    }
}

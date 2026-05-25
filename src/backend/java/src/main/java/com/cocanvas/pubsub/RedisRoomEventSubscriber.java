package com.cocanvas.pubsub;

import com.cocanvas.cluster.NodeIdentity;
import com.cocanvas.ws.RoomSessionRegistry;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.connection.Message;
import org.springframework.data.redis.connection.MessageListener;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "realtime.broadcaster", havingValue = "redis")
public class RedisRoomEventSubscriber implements MessageListener {

    private final RoomSessionRegistry registry;
    private final ObjectMapper objectMapper;
    private final NodeIdentity nodeIdentity;

    public RedisRoomEventSubscriber(
            RoomSessionRegistry registry,
            ObjectMapper objectMapper,
            NodeIdentity nodeIdentity
    ) {
        this.registry = registry;
        this.objectMapper = objectMapper;
        this.nodeIdentity = nodeIdentity;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            RoomBroadcastEvent event = objectMapper.readValue(message.getBody(), RoomBroadcastEvent.class);
            if (nodeIdentity.nodeId().equals(event.originNodeId())) {
                return;
            }

            registry.broadcastInRoom(event.roomId(), event.payload(), null);
        } catch (Exception ignored) {
            // Malformed pub/sub events are ignored so one bad frame cannot break the subscriber loop.
        }
    }
}

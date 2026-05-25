package com.cocanvas.pubsub;

import java.io.IOException;

import com.cocanvas.cluster.NodeIdentity;
import com.cocanvas.ws.RoomSessionRegistry;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.WebSocketSession;

@Component
@ConditionalOnProperty(name = "realtime.broadcaster", havingValue = "redis")
public class RedisRealtimeBroadcaster implements RealtimeBroadcaster {

    public static final String CHANNEL = "cocanvas:room-events";

    private final RoomSessionRegistry registry;
    private final ObjectMapper objectMapper;
    private final StringRedisTemplate redisTemplate;
    private final NodeIdentity nodeIdentity;

    public RedisRealtimeBroadcaster(
            RoomSessionRegistry registry,
            ObjectMapper objectMapper,
            StringRedisTemplate redisTemplate,
            NodeIdentity nodeIdentity
    ) {
        this.registry = registry;
        this.objectMapper = objectMapper;
        this.redisTemplate = redisTemplate;
        this.nodeIdentity = nodeIdentity;
    }

    @Override
    public void broadcast(String roomId, Object outbound, WebSocketSession exceptSession) throws IOException {
        String payload = objectMapper.writeValueAsString(outbound);
        registry.broadcastInRoom(roomId, payload, exceptSession);
        redisTemplate.convertAndSend(
                CHANNEL,
                objectMapper.writeValueAsString(new RoomBroadcastEvent(roomId, payload, nodeIdentity.nodeId()))
        );
    }
}

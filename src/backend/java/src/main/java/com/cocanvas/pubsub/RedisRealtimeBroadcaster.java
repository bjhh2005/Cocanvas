package com.cocanvas.pubsub;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;

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

    public static final String CHANNEL_PREFIX = "cocanvas:room-events:";
    public static final String TRANSIENT_CHANNEL_PREFIX = "cocanvas:room-transient-events:";
    public static final int CHANNEL_SHARDS = 64;

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
                channelFor(roomId),
                objectMapper.writeValueAsString(new RoomBroadcastEvent(roomId, payload, nodeIdentity.nodeId()))
        );
    }

    @Override
    public void broadcastTransient(String roomId, Object outbound, WebSocketSession exceptSession) throws IOException {
        String payload = objectMapper.writeValueAsString(outbound);
        registry.broadcastTransientInRoom(roomId, payload, exceptSession);
        redisTemplate.convertAndSend(
                transientChannelFor(roomId),
                objectMapper.writeValueAsString(new RoomBroadcastEvent(roomId, payload, nodeIdentity.nodeId()))
        );
    }

    public static String channelFor(String roomId) {
        return CHANNEL_PREFIX + Math.floorMod(hash(roomId), CHANNEL_SHARDS);
    }

    public static String transientChannelFor(String roomId) {
        return TRANSIENT_CHANNEL_PREFIX + Math.floorMod(hash(roomId), CHANNEL_SHARDS);
    }

    private static int hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            int result = 0;
            for (int index = 0; index < 4; index += 1) {
                result = (result << 8) | (bytes[index] & 0xff);
            }
            return result;
        } catch (Exception e) {
            return value.hashCode();
        }
    }
}

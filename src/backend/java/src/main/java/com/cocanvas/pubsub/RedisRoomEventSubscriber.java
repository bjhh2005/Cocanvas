package com.cocanvas.pubsub;

import com.cocanvas.cluster.NodeIdentity;
import com.cocanvas.protocol.outbound.OpBroadcastMessage;
import com.cocanvas.service.RoomReplicaService;
import com.cocanvas.ws.RoomSessionRegistry;
import com.fasterxml.jackson.databind.JsonNode;
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
    private final RoomReplicaService replicaService;

    public RedisRoomEventSubscriber(
            RoomSessionRegistry registry,
            ObjectMapper objectMapper,
            NodeIdentity nodeIdentity,
            RoomReplicaService replicaService
    ) {
        this.registry = registry;
        this.objectMapper = objectMapper;
        this.nodeIdentity = nodeIdentity;
        this.replicaService = replicaService;
    }

    @Override
    public void onMessage(Message message, byte[] pattern) {
        try {
            RoomBroadcastEvent event = objectMapper.readValue(message.getBody(), RoomBroadcastEvent.class);
            if (nodeIdentity.nodeId().equals(event.originNodeId())) {
                return;
            }

            JsonNode payload = objectMapper.readTree(event.payload());
            String type = payload.path("type").asText();
            if ("cursor".equals(type) || "shape-preview".equals(type)) {
                if (!registry.hasSessions(event.roomId())) {
                    return;
                }

                registry.broadcastTransientInRoom(event.roomId(), event.payload(), null);
                return;
            }

            applyRemoteOpToReplica(event, payload);
            if (registry.hasSessions(event.roomId())) {
                registry.broadcastInRoom(event.roomId(), event.payload(), null);
            }
        } catch (Exception ignored) {
            // Malformed pub/sub events are ignored so one bad frame cannot break the subscriber loop.
        }
    }

    private void applyRemoteOpToReplica(RoomBroadcastEvent event, JsonNode payload) throws Exception {
        if (!"op".equals(payload.path("type").asText())) {
            return;
        }

        OpBroadcastMessage opMessage = objectMapper.treeToValue(payload, OpBroadcastMessage.class);
        replicaService.applyRemote(event.roomId(), opMessage.hlc(), opMessage.userId(), opMessage.op());
    }
}

package com.cocanvas.cluster;

import java.time.Duration;
import java.util.List;
import java.util.Objects;
import java.util.Set;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "realtime.broadcaster", havingValue = "redis")
public class RedisNodeRegistry implements NodeRegistry {

    private static final String NODE_KEY_PREFIX = "cocanvas:nodes:";
    private static final String NODE_INDEX_KEY = "cocanvas:nodes";

    private final NodeIdentity nodeIdentity;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final String host;
    private final int port;
    private final String wsPath;

    public RedisNodeRegistry(
            NodeIdentity nodeIdentity,
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper,
            @Value("${node.public-host:localhost}") String host,
            @Value("${node.public-port:8080}") int port,
            @Value("${node.public-ws-path:/ws/collab}") String wsPath
    ) {
        this.nodeIdentity = nodeIdentity;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.host = host;
        this.port = port;
        this.wsPath = wsPath;
    }

    @Scheduled(fixedRate = 5000)
    public void heartbeat() throws Exception {
        NodeInfo nodeInfo = new NodeInfo(nodeIdentity.nodeId(), host, port, wsPath, System.currentTimeMillis());
        redisTemplate.opsForValue().set(
                NODE_KEY_PREFIX + nodeInfo.nodeId(),
                objectMapper.writeValueAsString(nodeInfo),
                Duration.ofSeconds(15)
        );
        redisTemplate.opsForSet().add(NODE_INDEX_KEY, nodeInfo.nodeId());
    }

    @Override
    public List<NodeInfo> aliveNodes() {
        Set<String> nodeIds = redisTemplate.opsForSet().members(NODE_INDEX_KEY);
        if (nodeIds == null || nodeIds.isEmpty()) {
            return List.of();
        }

        return nodeIds.stream()
                .map(this::readAliveNode)
                .filter(Objects::nonNull)
                .toList();
    }

    private NodeInfo readAliveNode(String nodeId) {
        String key = NODE_KEY_PREFIX + nodeId;
        String json = redisTemplate.opsForValue().get(key);
        if (json == null) {
            redisTemplate.opsForSet().remove(NODE_INDEX_KEY, nodeId);
            return null;
        }

        return readNode(json);
    }

    private NodeInfo readNode(String json) {
        try {
            return objectMapper.readValue(json, NodeInfo.class);
        } catch (Exception ignored) {
            return null;
        }
    }
}

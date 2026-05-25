package com.cocanvas.cluster;

import java.time.Duration;
import java.util.List;
import java.util.Objects;

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

    private final NodeIdentity nodeIdentity;
    private final StringRedisTemplate redisTemplate;
    private final ObjectMapper objectMapper;
    private final String host;
    private final int port;

    public RedisNodeRegistry(
            NodeIdentity nodeIdentity,
            StringRedisTemplate redisTemplate,
            ObjectMapper objectMapper,
            @Value("${node.public-host:localhost}") String host,
            @Value("${node.public-port:8080}") int port
    ) {
        this.nodeIdentity = nodeIdentity;
        this.redisTemplate = redisTemplate;
        this.objectMapper = objectMapper;
        this.host = host;
        this.port = port;
    }

    @Scheduled(fixedRate = 5000)
    public void heartbeat() throws Exception {
        NodeInfo nodeInfo = new NodeInfo(nodeIdentity.nodeId(), host, port, System.currentTimeMillis());
        redisTemplate.opsForValue().set(
                NODE_KEY_PREFIX + nodeInfo.nodeId(),
                objectMapper.writeValueAsString(nodeInfo),
                Duration.ofSeconds(15)
        );
    }

    @Override
    public List<NodeInfo> aliveNodes() {
        return redisTemplate.keys(NODE_KEY_PREFIX + "*").stream()
                .map(key -> redisTemplate.opsForValue().get(key))
                .filter(Objects::nonNull)
                .map(this::readNode)
                .filter(Objects::nonNull)
                .toList();
    }

    private NodeInfo readNode(String json) {
        try {
            return objectMapper.readValue(json, NodeInfo.class);
        } catch (Exception ignored) {
            return null;
        }
    }
}

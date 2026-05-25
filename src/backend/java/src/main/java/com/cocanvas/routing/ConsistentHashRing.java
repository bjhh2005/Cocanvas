package com.cocanvas.routing;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.NavigableMap;
import java.util.TreeMap;

public class ConsistentHashRing {

    private final NavigableMap<Long, String> ring = new TreeMap<>();
    private final int virtualNodes;

    public ConsistentHashRing(Collection<String> nodeIds, int virtualNodes) {
        this.virtualNodes = virtualNodes;
        nodeIds.forEach(this::addNode);
    }

    public void addNode(String nodeId) {
        for (int index = 0; index < virtualNodes; index += 1) {
            ring.put(hash(nodeId + "#" + index), nodeId);
        }
    }

    public String route(String key) {
        if (ring.isEmpty()) {
            return null;
        }

        long hash = hash(key);
        NavigableMap<Long, String> tail = ring.tailMap(hash, true);
        return (tail.isEmpty() ? ring.firstEntry() : tail.firstEntry()).getValue();
    }

    public List<String> nodes() {
        return new ArrayList<>(ring.values());
    }

    private long hash(String value) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
            long result = 0;
            for (int i = 0; i < 8; i += 1) {
                result = (result << 8) | (bytes[i] & 0xff);
            }
            return result & Long.MAX_VALUE;
        } catch (Exception e) {
            return Math.abs(value.hashCode());
        }
    }
}

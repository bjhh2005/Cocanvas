package com.cocanvas.routing;

import java.util.Comparator;
import java.util.List;
import java.util.Objects;

import com.cocanvas.cluster.NodeInfo;
import com.cocanvas.cluster.NodeRegistry;
import org.springframework.stereotype.Component;

@Component
public class NodeRouter {

    private final NodeRegistry nodeRegistry;
    private volatile RingSnapshot ringSnapshot = new RingSnapshot(List.of(), new ConsistentHashRing(List.of(), 64));

    public NodeRouter(NodeRegistry nodeRegistry) {
        this.nodeRegistry = nodeRegistry;
    }

    public NodeInfo routeRoom(String roomId) {
        List<NodeInfo> nodes = nodeRegistry.aliveNodes().stream()
                .sorted(Comparator.comparing(NodeInfo::nodeId))
                .toList();

        if (nodes.isEmpty()) {
            return new NodeInfo("local", "localhost", 8080, "/ws/collab", System.currentTimeMillis());
        }

        ConsistentHashRing ring = ringFor(nodes);
        String routedNodeId = ring.route(roomId);
        return nodes.stream()
                .filter(node -> node.nodeId().equals(routedNodeId))
                .findFirst()
                .orElse(nodes.getFirst());
    }

    private ConsistentHashRing ringFor(List<NodeInfo> nodes) {
        List<String> nodeIds = nodes.stream().map(NodeInfo::nodeId).toList();
        RingSnapshot current = ringSnapshot;
        if (Objects.equals(current.nodeIds(), nodeIds)) {
            return current.ring();
        }

        synchronized (this) {
            current = ringSnapshot;
            if (Objects.equals(current.nodeIds(), nodeIds)) {
                return current.ring();
            }

            RingSnapshot next = new RingSnapshot(nodeIds, new ConsistentHashRing(nodeIds, 64));
            ringSnapshot = next;
            return next.ring();
        }
    }

    private record RingSnapshot(List<String> nodeIds, ConsistentHashRing ring) {
    }
}

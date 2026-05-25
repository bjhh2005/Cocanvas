package com.cocanvas.routing;

import java.util.Comparator;
import java.util.List;

import com.cocanvas.cluster.NodeInfo;
import com.cocanvas.cluster.NodeRegistry;
import org.springframework.stereotype.Component;

@Component
public class NodeRouter {

    private final NodeRegistry nodeRegistry;

    public NodeRouter(NodeRegistry nodeRegistry) {
        this.nodeRegistry = nodeRegistry;
    }

    public NodeInfo routeRoom(String roomId) {
        List<NodeInfo> nodes = nodeRegistry.aliveNodes().stream()
                .sorted(Comparator.comparing(NodeInfo::nodeId))
                .toList();

        if (nodes.isEmpty()) {
            return new NodeInfo("local", "localhost", 8080, System.currentTimeMillis());
        }

        ConsistentHashRing ring = new ConsistentHashRing(nodes.stream().map(NodeInfo::nodeId).toList(), 64);
        String routedNodeId = ring.route(roomId);
        return nodes.stream()
                .filter(node -> node.nodeId().equals(routedNodeId))
                .findFirst()
                .orElse(nodes.getFirst());
    }
}

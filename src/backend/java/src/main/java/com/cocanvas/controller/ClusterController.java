package com.cocanvas.controller;

import java.util.List;

import com.cocanvas.cluster.NodeInfo;
import com.cocanvas.cluster.NodeRegistry;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ClusterController {

    private final NodeRegistry nodeRegistry;

    public ClusterController(NodeRegistry nodeRegistry) {
        this.nodeRegistry = nodeRegistry;
    }

    @GetMapping({"/api/cluster/nodes", "/cluster/nodes"})
    public ClusterNodesResponse nodes() {
        return new ClusterNodesResponse(nodeRegistry.aliveNodes());
    }

    public record ClusterNodesResponse(List<NodeInfo> nodes) {
    }
}

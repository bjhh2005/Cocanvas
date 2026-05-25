package com.cocanvas.cluster;

import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

@Component
public class NodeIdentity {

    private final String nodeId;

    public NodeIdentity(@Value("${node.id:}") String configuredNodeId) {
        this.nodeId = configuredNodeId == null || configuredNodeId.isBlank()
                ? "node-" + UUID.randomUUID().toString().substring(0, 8)
                : configuredNodeId;
    }

    public String nodeId() {
        return nodeId;
    }
}

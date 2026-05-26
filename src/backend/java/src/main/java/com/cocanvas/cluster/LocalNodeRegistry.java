package com.cocanvas.cluster;

import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "realtime.broadcaster", havingValue = "local", matchIfMissing = true)
public class LocalNodeRegistry implements NodeRegistry {

    private final NodeIdentity nodeIdentity;
    private final String host;
    private final int port;
    private final String wsPath;

    public LocalNodeRegistry(
            NodeIdentity nodeIdentity,
            @Value("${node.public-host:localhost}") String host,
            @Value("${node.public-port:8080}") int port,
            @Value("${node.public-ws-path:/ws/collab}") String wsPath
    ) {
        this.nodeIdentity = nodeIdentity;
        this.host = host;
        this.port = port;
        this.wsPath = wsPath;
    }

    @Override
    public List<NodeInfo> aliveNodes() {
        return List.of(new NodeInfo(nodeIdentity.nodeId(), host, port, wsPath, System.currentTimeMillis()));
    }
}

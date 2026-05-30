package com.cocanvas.controller;

import java.util.List;

import com.cocanvas.cluster.NodeInfo;
import com.cocanvas.cluster.NodeRegistry;
import com.cocanvas.service.RoomService;
import com.cocanvas.ws.RoomSessionRegistry;
import com.cocanvas.ws.SessionSendQueue;
import com.github.benmanes.caffeine.cache.stats.CacheStats;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class ClusterController {

    private final NodeRegistry nodeRegistry;
    private final RoomService roomService;
    private final RoomSessionRegistry sessionRegistry;

    public ClusterController(NodeRegistry nodeRegistry, RoomService roomService, RoomSessionRegistry sessionRegistry) {
        this.nodeRegistry = nodeRegistry;
        this.roomService = roomService;
        this.sessionRegistry = sessionRegistry;
    }

    @GetMapping({"/api/cluster/nodes", "/cluster/nodes"})
    public ClusterNodesResponse nodes() {
        return new ClusterNodesResponse(nodeRegistry.aliveNodes());
    }

    @GetMapping({"/api/cluster/cache-stats", "/cluster/cache-stats"})
    public CacheStatsResponse cacheStats() {
        CacheStats s = roomService.cacheStats();
        return new CacheStatsResponse(
                s.requestCount(),
                s.hitCount(),
                s.missCount(),
                s.hitRate(),
                s.missRate(),
                s.loadCount(),
                s.totalLoadTime() / 1_000_000L   // ns → ms
        );
    }

    @GetMapping({"/api/cluster/queue-stats", "/cluster/queue-stats"})
    public QueueStatsResponse queueStats() {
        SessionSendQueue.QueueStats s = sessionRegistry.queueStats();
        return new QueueStatsResponse(
                s.activeSessions(),
                s.totalQueuedMessages(),
                s.transientDrops(),
                s.overloadDisconnects()
        );
    }

    public record ClusterNodesResponse(List<NodeInfo> nodes) {}

    public record QueueStatsResponse(
            long activeSessions,
            long totalQueuedMessages,
            long transientDrops,
            long overloadDisconnects
    ) {}

    public record CacheStatsResponse(
            long requestCount,
            long hitCount,
            long missCount,
            double hitRate,
            double missRate,
            long loadCount,
            long totalLoadMs
    ) {}
}

package com.cocanvas.cluster;

public record NodeInfo(String nodeId, String host, int port, String wsPath, long lastHeartbeat) {
}

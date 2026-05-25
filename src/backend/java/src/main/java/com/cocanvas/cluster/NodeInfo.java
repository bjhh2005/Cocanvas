package com.cocanvas.cluster;

public record NodeInfo(String nodeId, String host, int port, long lastHeartbeat) {
}

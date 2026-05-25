package com.cocanvas.protocol.outbound;

public record PeerJoinedMessage(String type, String userId, String displayName, String color) {

    public PeerJoinedMessage(String userId, String displayName, String color) {
        this("peer-joined", userId, displayName, color);
    }
}

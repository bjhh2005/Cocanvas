package com.cocanvas.protocol.outbound;

public record PeerLeftMessage(String type, String userId) {

    public PeerLeftMessage(String userId) {
        this("peer-left", userId);
    }
}

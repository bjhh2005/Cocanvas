package com.cocanvas.protocol.outbound;

import java.util.List;

import com.cocanvas.protocol.common.PeerInfo;

public record JoinedMessage(String type, String roomId, PeerInfo you, List<PeerInfo> peers) {

    public JoinedMessage(String roomId, PeerInfo you, List<PeerInfo> peers) {
        this("joined", roomId, you, peers);
    }
}

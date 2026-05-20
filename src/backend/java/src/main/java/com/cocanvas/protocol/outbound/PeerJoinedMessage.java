package com.cocanvas.protocol.outbound;

import com.fasterxml.jackson.annotation.JsonProperty;

public record PeerJoinedMessage(String userId, String displayName, String color) {
    @JsonProperty("type")
    public String type() { return "peer-joined"; }
}

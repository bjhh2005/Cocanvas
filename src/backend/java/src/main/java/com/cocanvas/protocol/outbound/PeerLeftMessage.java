package com.cocanvas.protocol.outbound;

import com.fasterxml.jackson.annotation.JsonProperty;

public record PeerLeftMessage(String userId) {
    @JsonProperty("type")
    public String type() { return "peer-left"; }
}

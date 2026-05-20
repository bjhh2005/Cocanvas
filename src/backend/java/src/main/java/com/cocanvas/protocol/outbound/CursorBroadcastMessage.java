package com.cocanvas.protocol.outbound;

import com.fasterxml.jackson.annotation.JsonProperty;

public record CursorBroadcastMessage(String userId, double x, double y) {
    @JsonProperty("type")
    public String type() { return "cursor"; }
}

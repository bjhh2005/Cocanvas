package com.cocanvas.protocol.outbound;

import com.cocanvas.protocol.Op;
import com.fasterxml.jackson.annotation.JsonProperty;

public record OpBroadcastMessage(
    @JsonProperty("fromUserId") String fromUserId,
    @JsonProperty("hlc")        String hlc,
    @JsonProperty("op")         Op op
) {
    @JsonProperty("type")
    public String type() { return "op"; }
}

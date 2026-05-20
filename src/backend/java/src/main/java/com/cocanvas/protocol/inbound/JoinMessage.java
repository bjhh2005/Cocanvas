package com.cocanvas.protocol.inbound;

import com.fasterxml.jackson.annotation.JsonProperty;

public record JoinMessage(
    @JsonProperty("msgId")       String msgId,
    @JsonProperty("roomId")      String roomId,
    @JsonProperty("userId")      String userId,
    @JsonProperty("displayName") String displayName,
    @JsonProperty("color")       String color
) implements InboundMessage {}

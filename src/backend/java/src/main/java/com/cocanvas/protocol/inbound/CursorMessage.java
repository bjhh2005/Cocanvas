package com.cocanvas.protocol.inbound;

import com.fasterxml.jackson.annotation.JsonProperty;

public record CursorMessage(
    @JsonProperty("msgId")  String msgId,
    @JsonProperty("roomId") String roomId,
    @JsonProperty("userId") String userId,
    @JsonProperty("x")      double x,
    @JsonProperty("y")      double y
) implements InboundMessage {}

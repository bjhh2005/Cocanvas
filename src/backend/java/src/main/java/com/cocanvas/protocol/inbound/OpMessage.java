package com.cocanvas.protocol.inbound;

import com.cocanvas.protocol.Op;
import com.fasterxml.jackson.annotation.JsonProperty;

public record OpMessage(
    @JsonProperty("msgId")  String msgId,
    @JsonProperty("roomId") String roomId,
    @JsonProperty("userId") String userId,
    @JsonProperty("hlc")    String hlc,
    @JsonProperty("op")     Op op
) implements InboundMessage {}

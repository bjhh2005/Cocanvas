package com.cocanvas.protocol.inbound;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = JoinMessage.class, name = "join"),
        @JsonSubTypes.Type(value = CursorMessage.class, name = "cursor"),
        @JsonSubTypes.Type(value = OpMessage.class, name = "op")
})
public interface InboundMessage {
}

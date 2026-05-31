package com.cocanvas.protocol.inbound;

import com.fasterxml.jackson.annotation.JsonSubTypes;
import com.fasterxml.jackson.annotation.JsonTypeInfo;

@JsonTypeInfo(use = JsonTypeInfo.Id.NAME, property = "type")
@JsonSubTypes({
        @JsonSubTypes.Type(value = JoinMessage.class, name = "join"),
        @JsonSubTypes.Type(value = CursorMessage.class, name = "cursor"),
        @JsonSubTypes.Type(value = ShapePreviewMessage.class, name = "shape-preview"),
        @JsonSubTypes.Type(value = OpMessage.class, name = "op"),
        @JsonSubTypes.Type(value = RoomChatMessage.class, name = "room-chat"),
        @JsonSubTypes.Type(value = RoomEmojiMessage.class, name = "room-emoji"),
        @JsonSubTypes.Type(value = RoomPhaseMessage.class, name = "room-phase"),
        @JsonSubTypes.Type(value = RoomPhasesMessage.class, name = "room-phases")
})
public interface InboundMessage {
}

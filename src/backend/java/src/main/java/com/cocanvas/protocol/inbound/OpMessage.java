package com.cocanvas.protocol.inbound;

import com.cocanvas.protocol.common.ShapeOperation;

public record OpMessage(
        String msgId,
        String roomId,
        String userId,
        String hlc,
        ShapeOperation op
) implements InboundMessage {
}

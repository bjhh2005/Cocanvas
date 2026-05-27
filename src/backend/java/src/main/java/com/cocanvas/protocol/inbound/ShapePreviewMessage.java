package com.cocanvas.protocol.inbound;

import com.cocanvas.protocol.common.ShapeOperation;

public record ShapePreviewMessage(
        String msgId,
        String roomId,
        String userId,
        ShapeOperation op
) implements InboundMessage {
}

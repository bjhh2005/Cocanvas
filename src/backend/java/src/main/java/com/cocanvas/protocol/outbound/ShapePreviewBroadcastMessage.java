package com.cocanvas.protocol.outbound;

import com.cocanvas.protocol.common.ShapeOperation;

public record ShapePreviewBroadcastMessage(String type, String userId, ShapeOperation op) {

    public ShapePreviewBroadcastMessage(String userId, ShapeOperation op) {
        this("shape-preview", userId, op);
    }
}

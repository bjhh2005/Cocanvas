package com.cocanvas.protocol.outbound;

import com.cocanvas.protocol.common.ShapeOperation;

public record OpBroadcastMessage(String type, String userId, String hlc, ShapeOperation op) {

    public OpBroadcastMessage(String userId, String hlc, ShapeOperation op) {
        this("op", userId, hlc, op);
    }
}

package com.cocanvas.protocol.outbound;

public record OpAckMessage(String type, String opId, String hlc) {

    public OpAckMessage(String opId, String hlc) {
        this("op-ack", opId, hlc);
    }
}

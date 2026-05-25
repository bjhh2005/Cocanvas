package com.cocanvas.protocol.outbound;

public record ErrorMessage(String type, String code, String message) {

    public ErrorMessage(String code, String message) {
        this("error", code, message);
    }
}

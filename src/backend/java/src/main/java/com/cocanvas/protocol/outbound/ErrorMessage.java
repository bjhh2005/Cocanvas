package com.cocanvas.protocol.outbound;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.annotation.JsonProperty;

@JsonInclude(JsonInclude.Include.NON_NULL)
public record ErrorMessage(String code, String message, @JsonProperty("refMsgId") String refMsgId) {
    @JsonProperty("type")
    public String type() { return "error"; }
}

package com.cocanvas.protocol.outbound;

import com.fasterxml.jackson.annotation.JsonProperty;
import java.util.List;

public record JoinedMessage(String roomId, UserInfo you, List<UserInfo> peers) {
    @JsonProperty("type")
    public String type() { return "joined"; }
}

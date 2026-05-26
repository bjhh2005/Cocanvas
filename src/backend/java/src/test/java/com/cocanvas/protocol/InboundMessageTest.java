package com.cocanvas.protocol;

import static org.assertj.core.api.Assertions.assertThat;

import com.cocanvas.protocol.inbound.InboundMessage;
import com.cocanvas.protocol.inbound.JoinMessage;
import com.cocanvas.protocol.inbound.OpMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

class InboundMessageTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void deserializesJoinMessageByType() throws Exception {
        String json = """
                {
                  "type": "join",
                  "msgId": "m-1",
                  "roomId": "room-a",
                  "userId": "user-a",
                  "displayName": "Alice",
                  "color": "#e74c3c"
                }
                """;

        InboundMessage message = objectMapper.readValue(json, InboundMessage.class);

        assertThat(message).isInstanceOf(JoinMessage.class);
        JoinMessage join = (JoinMessage) message;
        assertThat(join.roomId()).isEqualTo("room-a");
        assertThat(join.userId()).isEqualTo("user-a");
        assertThat(join.displayName()).isEqualTo("Alice");
    }

    @Test
    void deserializesOpMessageByType() throws Exception {
        String json = """
                {
                  "type": "op",
                  "msgId": "m-2",
                  "roomId": "room-a",
                  "userId": "user-a",
                  "hlc": "1716123456789.0.user-a",
                  "op": {
                    "opId": "op-a",
                    "opType": "create",
                    "shapeId": "shape-a",
                    "shapeType": "rect",
                    "attrs": { "x": 100, "y": 120, "w": 140, "h": 90, "fill": "#3498db" }
                  }
                }
                """;

        InboundMessage message = objectMapper.readValue(json, InboundMessage.class);

        assertThat(message).isInstanceOf(OpMessage.class);
        OpMessage opMessage = (OpMessage) message;
        assertThat(opMessage.hlc()).isEqualTo("1716123456789.0.user-a");
        assertThat(opMessage.op().opId()).isEqualTo("op-a");
        assertThat(opMessage.op().shapeId()).isEqualTo("shape-a");
        assertThat(opMessage.op().attrs()).containsEntry("fill", "#3498db");
    }
}

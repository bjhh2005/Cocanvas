package com.cocanvas.protocol;

import com.cocanvas.protocol.inbound.CursorMessage;
import com.cocanvas.protocol.inbound.InboundMessage;
import com.cocanvas.protocol.inbound.JoinMessage;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class InboundMessageDeserializationTest {

    private final ObjectMapper objectMapper = new ObjectMapper();

    @Test
    void deserializeJoinMessage() throws Exception {
        String json = """
                {
                    "type": "join",
                    "msgId": "550e8400-e29b-41d4-a716-446655440000",
                    "roomId": "a1b2c3d4",
                    "userId": "u-11111111",
                    "displayName": "Alice",
                    "color": "#e74c3c"
                }
                """;

        InboundMessage msg = objectMapper.readValue(json, InboundMessage.class);

        assertThat(msg).isInstanceOf(JoinMessage.class);
        JoinMessage join = (JoinMessage) msg;
        assertThat(join.roomId()).isEqualTo("a1b2c3d4");
        assertThat(join.userId()).isEqualTo("u-11111111");
        assertThat(join.displayName()).isEqualTo("Alice");
        assertThat(join.color()).isEqualTo("#e74c3c");
    }

    @Test
    void deserializeCursorMessage() throws Exception {
        String json = """
                {
                    "type": "cursor",
                    "msgId": "550e8400-e29b-41d4-a716-446655440001",
                    "roomId": "a1b2c3d4",
                    "userId": "u-11111111",
                    "x": 312.5,
                    "y": 488.0
                }
                """;

        InboundMessage msg = objectMapper.readValue(json, InboundMessage.class);

        assertThat(msg).isInstanceOf(CursorMessage.class);
        CursorMessage cursor = (CursorMessage) msg;
        assertThat(cursor.x()).isEqualTo(312.5);
        assertThat(cursor.y()).isEqualTo(488.0);
    }
}

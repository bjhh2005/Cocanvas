package com.cocanvas.ws;

import java.io.IOException;
import java.util.Map;

import com.cocanvas.protocol.common.PeerInfo;
import com.cocanvas.protocol.inbound.CursorMessage;
import com.cocanvas.protocol.inbound.InboundMessage;
import com.cocanvas.protocol.inbound.JoinMessage;
import com.cocanvas.protocol.inbound.OpMessage;
import com.cocanvas.protocol.outbound.CursorBroadcastMessage;
import com.cocanvas.protocol.outbound.ErrorMessage;
import com.cocanvas.protocol.outbound.JoinedMessage;
import com.cocanvas.protocol.outbound.OpBroadcastMessage;
import com.cocanvas.protocol.outbound.PeerJoinedMessage;
import com.cocanvas.protocol.outbound.PeerLeftMessage;
import com.cocanvas.pubsub.RealtimeBroadcaster;
import com.cocanvas.service.HistoryService;
import com.cocanvas.service.RoomReplicaService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

@Component
public class CollabWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(CollabWebSocketHandler.class);

    private final RoomSessionRegistry registry;
    private final ObjectMapper objectMapper;
    private final RoomReplicaService replicaService;
    private final RealtimeBroadcaster broadcaster;
    private final HistoryService historyService;

    public CollabWebSocketHandler(
            RoomSessionRegistry registry,
            ObjectMapper objectMapper,
            RoomReplicaService replicaService,
            RealtimeBroadcaster broadcaster,
            org.springframework.beans.factory.ObjectProvider<HistoryService> historyServiceProvider
    ) {
        this.registry = registry;
        this.objectMapper = objectMapper;
        this.replicaService = replicaService;
        this.broadcaster = broadcaster;
        this.historyService = historyServiceProvider.getIfAvailable();
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        log.info("Collab websocket connected: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
        InboundMessage inbound = objectMapper.readValue(message.getPayload(), InboundMessage.class);

        if (inbound instanceof JoinMessage joinMessage) {
            handleJoin(session, joinMessage);
            return;
        }

        if (inbound instanceof CursorMessage cursorMessage) {
            handleCursor(session, cursorMessage);
            return;
        }

        if (inbound instanceof OpMessage opMessage) {
            handleOp(session, opMessage);
            return;
        }

        send(session, new ErrorMessage("unsupported_type", "Unsupported message type"));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) throws Exception {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);

        if (roomId != null && userId != null) {
            registry.leave(roomId, session);
            broadcaster.broadcast(roomId, new PeerLeftMessage(userId), session);
        }

        log.info("Collab websocket disconnected: {}, status={}", session.getId(), status);
    }

    private void handleJoin(WebSocketSession session, JoinMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        attributes.put(RoomSessionRegistry.ROOM_ID, message.roomId());
        attributes.put(RoomSessionRegistry.USER_ID, message.userId());
        attributes.put(RoomSessionRegistry.DISPLAY_NAME, message.displayName());
        attributes.put(RoomSessionRegistry.COLOR, message.color());

        PeerInfo you = new PeerInfo(message.userId(), message.displayName(), message.color());
        var peers = registry.peers(message.roomId(), session);
        registry.join(message.roomId(), session);

        send(session, new JoinedMessage(message.roomId(), you, peers));
        broadcaster.broadcast(
                message.roomId(),
                new PeerJoinedMessage(message.userId(), message.displayName(), message.color()),
                session
        );
    }

    private void handleCursor(WebSocketSession session, CursorMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);

        if (roomId == null || userId == null) {
            send(session, new ErrorMessage("not_joined", "Send join before cursor"));
            return;
        }

        String displayName = attribute(attributes, RoomSessionRegistry.DISPLAY_NAME);
        String color = attribute(attributes, RoomSessionRegistry.COLOR);
        broadcaster.broadcast(
                roomId,
                new CursorBroadcastMessage(userId, displayName, color, message.x(), message.y()),
                session
        );
    }

    private void handleOp(WebSocketSession session, OpMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);

        if (roomId == null || userId == null) {
            send(session, new ErrorMessage("not_joined", "Send join before op"));
            return;
        }

        String mergedHlc = replicaService.apply(roomId, message.hlc(), userId, message.op());
        if (historyService != null) {
            historyService.recordOperation(roomId, userId, mergedHlc, message.op());
        }
        broadcaster.broadcast(
                roomId,
                new OpBroadcastMessage(userId, mergedHlc, message.op()),
                session
        );
    }

    private void send(WebSocketSession session, Object outbound) throws IOException {
        synchronized (session) {
            session.sendMessage(new TextMessage(serialize(outbound)));
        }
    }

    private String serialize(Object outbound) throws IOException {
        return objectMapper.writeValueAsString(outbound);
    }

    private String attribute(Map<String, Object> attributes, String key) {
        Object value = attributes.get(key);
        return value == null ? null : String.valueOf(value);
    }
}

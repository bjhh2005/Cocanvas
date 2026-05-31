package com.cocanvas.ws;

import java.io.IOException;
import java.util.Map;

import com.cocanvas.protocol.common.PeerInfo;
import com.cocanvas.protocol.inbound.CursorMessage;
import com.cocanvas.protocol.inbound.InboundMessage;
import com.cocanvas.protocol.inbound.JoinMessage;
import com.cocanvas.protocol.inbound.OpMessage;
import com.cocanvas.protocol.inbound.RoomChatMessage;
import com.cocanvas.protocol.inbound.RoomEmojiMessage;
import com.cocanvas.protocol.inbound.RoomPhaseMessage;
import com.cocanvas.protocol.inbound.RoomPhasesMessage;
import com.cocanvas.protocol.inbound.ShapePreviewMessage;
import com.cocanvas.protocol.outbound.CursorBroadcastMessage;
import com.cocanvas.protocol.outbound.ErrorMessage;
import com.cocanvas.protocol.outbound.JoinedMessage;
import com.cocanvas.protocol.outbound.OpAckMessage;
import com.cocanvas.protocol.outbound.OpBroadcastMessage;
import com.cocanvas.protocol.outbound.PeerJoinedMessage;
import com.cocanvas.protocol.outbound.PeerLeftMessage;
import com.cocanvas.protocol.outbound.RoomChatBroadcastMessage;
import com.cocanvas.protocol.outbound.RoomEmojiBroadcastMessage;
import com.cocanvas.protocol.outbound.RoomPhaseBroadcastMessage;
import com.cocanvas.protocol.outbound.RoomPhasesBroadcastMessage;
import com.cocanvas.protocol.outbound.ShapePreviewBroadcastMessage;
import com.cocanvas.pubsub.RealtimeBroadcaster;
import com.cocanvas.service.HistoryService;
import com.cocanvas.service.JoinTokenService;
import com.cocanvas.service.RoomReplicaService;
import com.cocanvas.service.RoomService;
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
    private final JoinTokenService joinTokenService;
    private final RoomService roomService;
    private final HistoryService historyService;

    public CollabWebSocketHandler(
            RoomSessionRegistry registry,
            ObjectMapper objectMapper,
            RoomReplicaService replicaService,
            RealtimeBroadcaster broadcaster,
            JoinTokenService joinTokenService,
            RoomService roomService,
            org.springframework.beans.factory.ObjectProvider<HistoryService> historyServiceProvider
    ) {
        this.registry = registry;
        this.objectMapper = objectMapper;
        this.replicaService = replicaService;
        this.broadcaster = broadcaster;
        this.joinTokenService = joinTokenService;
        this.roomService = roomService;
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

        if (inbound instanceof ShapePreviewMessage previewMessage) {
            handleShapePreview(session, previewMessage);
            return;
        }

        if (inbound instanceof RoomChatMessage chatMessage) {
            handleRoomChat(session, chatMessage);
            return;
        }

        if (inbound instanceof RoomEmojiMessage emojiMessage) {
            handleRoomEmoji(session, emojiMessage);
            return;
        }

        if (inbound instanceof RoomPhaseMessage phaseMessage) {
            handleRoomPhase(session, phaseMessage);
            return;
        }

        if (inbound instanceof RoomPhasesMessage phasesMessage) {
            handleRoomPhases(session, phasesMessage);
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
        var claims = joinTokenService.verify(message.roomId(), message.joinToken());
        if (!claims.valid()) {
            sendImmediate(session, new ErrorMessage("invalid_join_token", "Join token is missing, invalid, or expired"));
            session.close(CloseStatus.POLICY_VIOLATION);
            return;
        }

        Map<String, Object> attributes = session.getAttributes();
        attributes.put(RoomSessionRegistry.ROOM_ID, message.roomId());
        attributes.put(RoomSessionRegistry.USER_ID, message.userId());
        attributes.put(RoomSessionRegistry.DISPLAY_NAME, message.displayName());
        attributes.put(RoomSessionRegistry.COLOR, message.color());
        attributes.put(RoomSessionRegistry.PERMISSION_MODE, claims.permissionMode());

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
        broadcaster.broadcastTransient(
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

        String permissionMode = attribute(attributes, RoomSessionRegistry.PERMISSION_MODE);
        if (!roomService.canWrite(permissionMode, message.op().opType(), message.op().shapeType())) {
            send(session, new ErrorMessage("permission_denied", "Room permission does not allow this operation"));
            return;
        }

        String mergedHlc = replicaService.mergeHlc(message.hlc());
        if (historyService != null && !historyService.tryRecordOperation(roomId, userId, mergedHlc, message.op())) {
            send(session, new ErrorMessage("op_persist_failed", "Operation was not persisted; retry after reconnect"));
            return;
        }

        replicaService.applyCommitted(roomId, mergedHlc, userId, message.op());
        send(session, new OpAckMessage(message.op().opId(), mergedHlc));
        broadcaster.broadcast(
                roomId,
                new OpBroadcastMessage(userId, mergedHlc, message.op()),
                session
        );
    }

    private void handleShapePreview(WebSocketSession session, ShapePreviewMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);

        if (roomId == null || userId == null) {
            send(session, new ErrorMessage("not_joined", "Send join before shape preview"));
            return;
        }

        broadcaster.broadcastTransient(
                roomId,
                new ShapePreviewBroadcastMessage(userId, message.op()),
                session
        );
    }

    private void handleRoomChat(WebSocketSession session, RoomChatMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);
        if (roomId == null || userId == null) {
            send(session, new ErrorMessage("not_joined", "Send join before room-chat"));
            return;
        }
        broadcaster.broadcastTransient(
                roomId,
                new RoomChatBroadcastMessage(userId, message.displayName(), message.color(), message.text(), message.timestamp()),
                session
        );
    }

    private void handleRoomEmoji(WebSocketSession session, RoomEmojiMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);
        if (roomId == null || userId == null) {
            send(session, new ErrorMessage("not_joined", "Send join before room-emoji"));
            return;
        }
        broadcaster.broadcastTransient(
                roomId,
                new RoomEmojiBroadcastMessage(userId, message.emoji()),
                session
        );
    }

    private void handleRoomPhase(WebSocketSession session, RoomPhaseMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);
        if (roomId == null || userId == null) {
            send(session, new ErrorMessage("not_joined", "Send join before room-phase"));
            return;
        }
        broadcaster.broadcast(
                roomId,
                new RoomPhaseBroadcastMessage(userId, message.phaseId()),
                session
        );
    }

    private void handleRoomPhases(WebSocketSession session, RoomPhasesMessage message) throws IOException {
        Map<String, Object> attributes = session.getAttributes();
        String roomId = attribute(attributes, RoomSessionRegistry.ROOM_ID);
        String userId = attribute(attributes, RoomSessionRegistry.USER_ID);
        if (roomId == null || userId == null) {
            send(session, new ErrorMessage("not_joined", "Send join before room-phases"));
            return;
        }
        broadcaster.broadcast(
                roomId,
                new RoomPhasesBroadcastMessage(userId, message.phases()),
                session
        );
    }

    private void send(WebSocketSession session, Object outbound) throws IOException {
        registry.send(session, serialize(outbound));
    }

    private void sendImmediate(WebSocketSession session, Object outbound) throws IOException {
        if (!session.isOpen()) {
            return;
        }

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

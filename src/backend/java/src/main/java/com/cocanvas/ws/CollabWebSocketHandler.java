package com.cocanvas.ws;

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
import com.cocanvas.protocol.outbound.UserInfo;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.lang.NonNull;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.handler.TextWebSocketHandler;

import java.io.IOException;
import java.util.List;
import java.util.Map;

@Component
public class CollabWebSocketHandler extends TextWebSocketHandler {

    private static final Logger log = LoggerFactory.getLogger(CollabWebSocketHandler.class);

    private static final String ATTR_ROOM_ID      = "roomId";
    private static final String ATTR_USER_ID      = "userId";
    private static final String ATTR_DISPLAY_NAME = "displayName";
    private static final String ATTR_COLOR        = "color";

    private final RoomSessionRegistry registry;
    private final RoomShapeStore shapeStore;
    private final ObjectMapper objectMapper;

    public CollabWebSocketHandler(RoomSessionRegistry registry,
                                  RoomShapeStore shapeStore,
                                  ObjectMapper objectMapper) {
        this.registry = registry;
        this.shapeStore = shapeStore;
        this.objectMapper = objectMapper;
    }

    @Override
    public void afterConnectionEstablished(@NonNull WebSocketSession session) {
        log.info("[collab] connection established: {}", session.getId());
    }

    @Override
    protected void handleTextMessage(@NonNull WebSocketSession session, @NonNull TextMessage message) {
        InboundMessage msg;
        try {
            msg = objectMapper.readValue(message.getPayload(), InboundMessage.class);
        } catch (Exception e) {
            sendError(session, "invalid_message", e.getMessage(), null);
            return;
        }

        if (msg instanceof JoinMessage join) {
            handleJoin(session, join);
        } else if (msg instanceof CursorMessage cursor) {
            handleCursor(session, cursor);
        } else if (msg instanceof OpMessage op) {
            handleOp(session, op);
        }
    }

    private void handleJoin(WebSocketSession session, JoinMessage join) {
        // Snapshot existing peers before registering self
        List<UserInfo> peers = registry.getSessions(join.roomId()).stream()
            .filter(s -> s.isOpen() && !s.equals(session))
            .map(s -> new UserInfo(
                (String) s.getAttributes().get(ATTR_USER_ID),
                (String) s.getAttributes().get(ATTR_DISPLAY_NAME),
                (String) s.getAttributes().get(ATTR_COLOR)
            ))
            .filter(u -> u.userId() != null)
            .toList();

        // Store identity so afterConnectionClosed can clean up
        Map<String, Object> attrs = session.getAttributes();
        attrs.put(ATTR_ROOM_ID,      join.roomId());
        attrs.put(ATTR_USER_ID,      join.userId());
        attrs.put(ATTR_DISPLAY_NAME, join.displayName());
        attrs.put(ATTR_COLOR,        join.color());

        // Send JoinedMessage + shape snapshot BEFORE registering in the room,
        // so the new client gets a consistent baseline with no race against live ops.
        send(session, new JoinedMessage(
            join.roomId(),
            new UserInfo(join.userId(), join.displayName(), join.color()),
            peers
        ));
        shapeStore.getSnapshot(join.roomId()).forEach(op ->
            send(session, new OpBroadcastMessage("", null, op)));

        registry.join(join.roomId(), session);
        broadcast(join.roomId(), new PeerJoinedMessage(join.userId(), join.displayName(), join.color()), session);
    }

    private void handleOp(WebSocketSession session, OpMessage op) {
        String roomId = (String) session.getAttributes().get(ATTR_ROOM_ID);
        if (roomId == null) {
            sendError(session, "not_joined", "send join before op", op.msgId());
            return;
        }
        // Update in-memory room state so late joiners get the full picture
        shapeStore.applyOp(roomId, op.op());
        broadcast(roomId, new OpBroadcastMessage(op.userId(), op.hlc(), op.op()), session);
    }

    private void handleCursor(WebSocketSession session, CursorMessage cursor) {
        String roomId = (String) session.getAttributes().get(ATTR_ROOM_ID);
        if (roomId == null) {
            sendError(session, "not_joined", "send join before cursor", cursor.msgId());
            return;
        }
        broadcast(roomId, new CursorBroadcastMessage(cursor.userId(), cursor.x(), cursor.y()), session);
    }

    @Override
    public void afterConnectionClosed(@NonNull WebSocketSession session, @NonNull CloseStatus status) {
        log.info("[collab] connection closed: {} status={}", session.getId(), status);
        Map<String, Object> attrs = session.getAttributes();
        String roomId = (String) attrs.get(ATTR_ROOM_ID);
        String userId = (String) attrs.get(ATTR_USER_ID);
        if (roomId != null && userId != null) {
            registry.leave(roomId, session);
            broadcast(roomId, new PeerLeftMessage(userId), null);
        }
    }

    private void send(WebSocketSession session, Object payload) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            synchronized (session) {
                session.sendMessage(new TextMessage(json));
            }
        } catch (IOException e) {
            log.warn("[collab] failed to send to {}: {}", session.getId(), e.getMessage());
        }
    }

    private void broadcast(String roomId, Object payload, WebSocketSession except) {
        try {
            String json = objectMapper.writeValueAsString(payload);
            registry.broadcastInRoom(roomId, json, except);
        } catch (IOException e) {
            log.warn("[collab] failed to serialize broadcast: {}", e.getMessage());
        }
    }

    private void sendError(WebSocketSession session, String code, String message, String refMsgId) {
        send(session, new ErrorMessage(code, message, refMsgId));
    }
}

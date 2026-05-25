package com.cocanvas.ws;

import java.io.IOException;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

import com.cocanvas.protocol.common.PeerInfo;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

@Component
public class RoomSessionRegistry {

    public static final String ROOM_ID = "roomId";
    public static final String USER_ID = "userId";
    public static final String DISPLAY_NAME = "displayName";
    public static final String COLOR = "color";

    private final Map<String, Set<WebSocketSession>> sessionsByRoom = new ConcurrentHashMap<>();

    public void join(String roomId, WebSocketSession session) {
        sessionsByRoom.computeIfAbsent(roomId, key -> ConcurrentHashMap.newKeySet()).add(session);
    }

    public void leave(String roomId, WebSocketSession session) {
        Set<WebSocketSession> sessions = sessionsByRoom.get(roomId);
        if (sessions == null) {
            return;
        }

        sessions.remove(session);
        if (sessions.isEmpty()) {
            sessionsByRoom.remove(roomId, sessions);
        }
    }

    public void broadcastInRoom(String roomId, String message, WebSocketSession exceptSession) throws IOException {
        Set<WebSocketSession> sessions = sessionsByRoom.getOrDefault(roomId, Set.of());
        for (WebSocketSession session : sessions) {
            if (session.equals(exceptSession) || !session.isOpen()) {
                continue;
            }

            synchronized (session) {
                session.sendMessage(new TextMessage(message));
            }
        }
    }

    public List<PeerInfo> peers(String roomId, WebSocketSession exceptSession) {
        return sessionsByRoom.getOrDefault(roomId, Set.of()).stream()
                .filter(session -> !session.equals(exceptSession))
                .map(this::toPeerInfo)
                .toList();
    }

    private PeerInfo toPeerInfo(WebSocketSession session) {
        Map<String, Object> attributes = session.getAttributes();
        return new PeerInfo(
                String.valueOf(attributes.get(USER_ID)),
                String.valueOf(attributes.get(DISPLAY_NAME)),
                String.valueOf(attributes.get(COLOR))
        );
    }
}

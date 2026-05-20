package com.cocanvas.ws;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

import java.io.IOException;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

@Component
public class RoomSessionRegistry {

    private static final Logger log = LoggerFactory.getLogger(RoomSessionRegistry.class);

    private final ConcurrentHashMap<String, Set<WebSocketSession>> rooms = new ConcurrentHashMap<>();

    public void join(String roomId, WebSocketSession session) {
        rooms.computeIfAbsent(roomId, k -> ConcurrentHashMap.newKeySet()).add(session);
        log.info("session {} joined room {}", session.getId(), roomId);
    }

    public void leave(String roomId, WebSocketSession session) {
        Set<WebSocketSession> sessions = rooms.get(roomId);
        if (sessions != null) {
            sessions.remove(session);
            if (sessions.isEmpty()) {
                rooms.remove(roomId);
            }
        }
        log.info("session {} left room {}", session.getId(), roomId);
    }

    public Set<WebSocketSession> getSessions(String roomId) {
        Set<WebSocketSession> s = rooms.get(roomId);
        return s != null ? Set.copyOf(s) : Set.of();
    }

    public void broadcastInRoom(String roomId, String message, WebSocketSession exceptSession) {
        if (message == null) return;
        Set<WebSocketSession> sessions = rooms.get(roomId);
        if (sessions == null) return;
        TextMessage textMessage = new TextMessage(message);
        for (WebSocketSession s : sessions) {
            if (s.equals(exceptSession) || !s.isOpen()) continue;
            try {
                s.sendMessage(textMessage);
            } catch (IOException e) {
                log.warn("failed to send to session {} in room {}: {}", s.getId(), roomId, e.getMessage());
            }
        }
    }
}

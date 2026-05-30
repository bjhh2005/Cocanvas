package com.cocanvas.pubsub;

import java.io.IOException;

import org.springframework.web.socket.WebSocketSession;

public interface RealtimeBroadcaster {

    void broadcast(String roomId, Object outbound, WebSocketSession exceptSession) throws IOException;

    default void broadcastTransient(String roomId, Object outbound, WebSocketSession exceptSession) throws IOException {
        broadcast(roomId, outbound, exceptSession);
    }
}

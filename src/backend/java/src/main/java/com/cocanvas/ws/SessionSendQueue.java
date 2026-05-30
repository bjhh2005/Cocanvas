package com.cocanvas.ws;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

public class SessionSendQueue {

    private static final int MAX_QUEUE_SIZE = 256;
    private static final int TRANSIENT_DROP_THRESHOLD = 96;

    private final Map<String, QueueState> queues = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    public void send(WebSocketSession session, String payload, boolean transientMessage) throws IOException {
        if (!session.isOpen()) {
            return;
        }

        QueueState state = queues.computeIfAbsent(session.getId(), key -> new QueueState());
        synchronized (state) {
            if (transientMessage && state.queue.size() >= TRANSIENT_DROP_THRESHOLD) {
                return;
            }

            if (state.queue.size() >= MAX_QUEUE_SIZE) {
                unregister(session);
                session.close(CloseStatus.SERVICE_OVERLOAD);
                return;
            }

            state.queue.addLast(payload);
            if (state.sending) {
                return;
            }

            state.sending = true;
        }

        executor.execute(() -> {
            try {
                drain(session, state);
            } catch (IOException ignored) {
                unregister(session);
            }
        });
    }

    public void unregister(WebSocketSession session) {
        queues.remove(session.getId());
    }

    private void drain(WebSocketSession session, QueueState state) throws IOException {
        while (session.isOpen()) {
            String payload;
            synchronized (state) {
                payload = state.queue.pollFirst();
                if (payload == null) {
                    state.sending = false;
                    return;
                }
            }

            synchronized (session) {
                session.sendMessage(new TextMessage(payload));
            }
        }
    }

    private static class QueueState {
        private final Deque<String> queue = new ArrayDeque<>();
        private boolean sending;
    }
}

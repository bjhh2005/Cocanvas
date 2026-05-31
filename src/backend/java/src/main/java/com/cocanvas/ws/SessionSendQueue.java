package com.cocanvas.ws;

import java.io.IOException;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicLong;

import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

public class SessionSendQueue {

    private static final int MAX_QUEUE_SIZE = 256;
    private static final int TRANSIENT_DROP_THRESHOLD = 96;

    private final Map<String, QueueState> queues = new ConcurrentHashMap<>();
    private final ExecutorService executor = Executors.newVirtualThreadPerTaskExecutor();

    /** Cumulative count of transient messages dropped due to queue pressure. */
    private final AtomicLong transientDrops = new AtomicLong();

    /** Cumulative count of sessions closed due to overload (queue full on reliable message). */
    private final AtomicLong overloadDisconnects = new AtomicLong();

    public record QueueStats(long activeSessions, long totalQueuedMessages,
                             long transientDrops, long overloadDisconnects) {}

    public void send(WebSocketSession session, String payload, boolean transientMessage) throws IOException {
        if (!session.isOpen()) {
            return;
        }

        String transientKey = transientMessage ? transientKeyFor(payload) : null;
        QueueState state = queues.computeIfAbsent(session.getId(), key -> new QueueState());
        synchronized (state) {
            if (transientKey != null) {
                state.queue.removeIf(item -> transientKey.equals(item.transientKey()));
            }

            if (transientMessage && state.queue.size() >= TRANSIENT_DROP_THRESHOLD) {
                transientDrops.incrementAndGet();
                return;
            }

            if (state.queue.size() >= MAX_QUEUE_SIZE) {
                overloadDisconnects.incrementAndGet();
                unregister(session);
                session.close(CloseStatus.SERVICE_OVERLOAD);
                return;
            }

            state.queue.addLast(new QueuedMessage(payload, transientKey));
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

    /** Snapshot of current queue metrics (non-blocking). */
    public QueueStats stats() {
        long sessions = queues.size();
        long totalQueued = queues.values().stream()
                .mapToLong(s -> { synchronized (s) { return s.queue.size(); } })
                .sum();
        return new QueueStats(sessions, totalQueued, transientDrops.get(), overloadDisconnects.get());
    }

    private void drain(WebSocketSession session, QueueState state) throws IOException {
        while (session.isOpen()) {
            QueuedMessage queued;
            synchronized (state) {
                queued = state.queue.pollFirst();
                if (queued == null) {
                    state.sending = false;
                    return;
                }
            }

            synchronized (session) {
                session.sendMessage(new TextMessage(queued.payload()));
            }
        }
    }

    private String transientKeyFor(String payload) {
        if (payload.contains("\"type\":\"cursor\"")) {
            String userId = jsonStringField(payload, "userId");
            return userId == null ? null : "cursor:" + userId;
        }

        if (payload.contains("\"type\":\"shape-preview\"")) {
            String userId = jsonStringField(payload, "userId");
            String shapeId = jsonStringField(payload, "shapeId");
            if (userId != null && shapeId != null) {
                return "shape-preview:" + userId + ":" + shapeId;
            }
        }

        return null;
    }

    private String jsonStringField(String payload, String field) {
        String marker = "\"" + field + "\":\"";
        int start = payload.indexOf(marker);
        if (start < 0) {
            return null;
        }

        start += marker.length();
        int end = payload.indexOf('"', start);
        return end > start ? payload.substring(start, end) : null;
    }

    private record QueuedMessage(String payload, String transientKey) {}

    private static class QueueState {
        private final Deque<QueuedMessage> queue = new ArrayDeque<>();
        private boolean sending;
    }
}

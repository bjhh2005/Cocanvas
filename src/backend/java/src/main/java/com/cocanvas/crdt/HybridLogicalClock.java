package com.cocanvas.crdt;

import java.util.concurrent.atomic.AtomicLong;

import org.springframework.stereotype.Component;

@Component
public class HybridLogicalClock {

    private final AtomicLong lastPhysicalMs = new AtomicLong(System.currentTimeMillis());
    private final AtomicLong logicalCounter = new AtomicLong(0);
    private final String nodeId = "node-local";

    public synchronized String now() {
        long currentPhysicalMs = System.currentTimeMillis();
        long last = lastPhysicalMs.get();

        if (currentPhysicalMs > last) {
            lastPhysicalMs.set(currentPhysicalMs);
            logicalCounter.set(0);
        } else {
            logicalCounter.incrementAndGet();
        }

        return format(lastPhysicalMs.get(), logicalCounter.get());
    }

    public synchronized String update(String remoteHlc) {
        HlcParts remote = parse(remoteHlc);
        long currentPhysicalMs = System.currentTimeMillis();
        long localPhysicalMs = lastPhysicalMs.get();
        long maxPhysicalMs = Math.max(Math.max(currentPhysicalMs, localPhysicalMs), remote.physicalMs());

        long nextLogical;
        if (maxPhysicalMs == localPhysicalMs && maxPhysicalMs == remote.physicalMs()) {
            nextLogical = Math.max(logicalCounter.get(), remote.logicalCounter()) + 1;
        } else if (maxPhysicalMs == localPhysicalMs) {
            nextLogical = logicalCounter.incrementAndGet();
        } else if (maxPhysicalMs == remote.physicalMs()) {
            nextLogical = remote.logicalCounter() + 1;
        } else {
            nextLogical = 0;
        }

        lastPhysicalMs.set(maxPhysicalMs);
        logicalCounter.set(nextLogical);
        return format(maxPhysicalMs, nextLogical);
    }

    public int compare(String left, String right) {
        HlcParts a = parse(left);
        HlcParts b = parse(right);

        int physical = Long.compare(a.physicalMs(), b.physicalMs());
        if (physical != 0) {
            return physical;
        }

        int logical = Long.compare(a.logicalCounter(), b.logicalCounter());
        if (logical != 0) {
            return logical;
        }

        return a.nodeId().compareTo(b.nodeId());
    }

    private String format(long physicalMs, long logical) {
        return physicalMs + "." + logical + "." + nodeId;
    }

    private HlcParts parse(String hlc) {
        if (hlc == null || hlc.isBlank()) {
            return new HlcParts(0, 0, "");
        }

        String[] parts = hlc.split("\\.", 3);
        if (parts.length != 3) {
            return new HlcParts(0, 0, "");
        }

        return new HlcParts(Long.parseLong(parts[0]), Long.parseLong(parts[1]), parts[2]);
    }

    private record HlcParts(long physicalMs, long logicalCounter, String nodeId) {
    }
}

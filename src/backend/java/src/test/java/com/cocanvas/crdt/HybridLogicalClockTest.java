package com.cocanvas.crdt;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;

class HybridLogicalClockTest {

    @Test
    void generatedTimestampsIncreaseMonotonically() {
        HybridLogicalClock clock = new HybridLogicalClock();

        String first = clock.now();
        String second = clock.now();

        assertThat(clock.compare(second, first)).isGreaterThan(0);
    }

    @Test
    void updateMovesPastRemoteTimestamp() {
        HybridLogicalClock clock = new HybridLogicalClock();

        String merged = clock.update("9999999999999.4.remote-node");

        assertThat(clock.compare(merged, "9999999999999.4.remote-node")).isGreaterThan(0);
    }
}

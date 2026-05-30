// Node.js < 22 doesn't have a built-in WebSocket; polyfill with the `ws` package.
if (typeof WebSocket === 'undefined') {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const WsImpl = require('ws');
  globalThis.WebSocket = WsImpl;
}

const baseUrl = process.env.COCANVAS_BASE_URL ?? 'http://localhost:8088';
const wsBase = process.env.COCANVAS_WS_BASE ?? 'ws://localhost:8088';
const roomId = process.env.COCANVAS_ROOM_ID ?? `perf${Date.now().toString(36)}`;
const opCount = Number(process.env.COCANVAS_OPS ?? 300);
const routeRequests = Number(process.env.COCANVAS_ROUTE_REQUESTS ?? 300);
const concurrentPeers = Number(process.env.COCANVAS_PEERS ?? 20);
const burstMessages = Number(process.env.COCANVAS_BURST ?? 200);
const historyAt = process.env.COCANVAS_HISTORY_AT;

const nowHlc = (nodeId, counter = 0) => `${Date.now()}.${counter}.${nodeId}`;
const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
};

const postJson = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const getJson = async (path) => {
  const start = performance.now();
  const response = await fetch(`${baseUrl}${path}`);
  const elapsed = performance.now() - start;
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return { json: await response.json(), elapsed };
};

// Lightweight stats-only fetch (no timing needed)
const fetchStats = async (path) => {
  const response = await fetch(`${baseUrl}${path}`);
  if (!response.ok) throw new Error(`${path} failed: ${response.status}`);
  return response.json();
};

class WsPeer {
  constructor(url, userId) {
    this.url = url;
    this.userId = userId;
    this.messages = [];
    this.waiters = [];
    this.socket = null;
    this.disconnected = false;
  }

  async connect(room, joinToken) {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`connect timeout ${this.url}`)), 10000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`connect error ${this.url}`));
      }, { once: true });
      this.socket.addEventListener('close', () => {
        this.disconnected = true;
      });
    });

    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      this.messages.push(message);
      this.waiters = this.waiters.filter((waiter) => {
        if (waiter.predicate(message)) {
          waiter.resolve(message);
          return false;
        }
        return true;
      });
    });

    this.socket.addEventListener('close', () => {
      this.disconnected = true;
    });

    this.send({
      type: 'join',
      msgId: crypto.randomUUID(),
      roomId: room,
      userId: this.userId,
      displayName: this.userId,
      color: '#2563eb',
      joinToken,
    });
    await this.waitFor((message) => message.type === 'joined');
  }

  send(message) {
    if (!this.disconnected) {
      this.socket.send(JSON.stringify(message));
    }
  }

  waitFor(predicate, timeoutMs = 10000) {
    const existing = this.messages.find(predicate);
    if (existing) {
      return Promise.resolve(existing);
    }

    return new Promise((resolve, reject) => {
      const waiter = { predicate, resolve };
      this.waiters.push(waiter);
      setTimeout(() => {
        this.waiters = this.waiters.filter((item) => item !== waiter);
        reject(new Error(`waitFor timeout ${this.userId}`));
      }, timeoutMs);
    });
  }

  close() {
    this.socket?.close();
  }
}

const sendOpAndWaitAck = async (peer, room, index) => {
  const opId = `${peer.userId}-op-${index}-${crypto.randomUUID()}`;
  const start = performance.now();
  peer.send({
    type: 'op',
    msgId: crypto.randomUUID(),
    roomId: room,
    userId: peer.userId,
    hlc: nowHlc(peer.userId, index),
    op: {
      opId,
      opType: index === 0 ? 'create' : 'update',
      shapeId: 'shape-main',
      shapeType: 'rect',
      attrs: index === 0
        ? { x: 80, y: 80, w: 120, h: 72, fill: '#93c5fd' }
        : { x: 80 + index, y: 80 + index, text: `op-${index}` },
    },
  });
  await peer.waitFor((message) => message.type === 'op-ack' && message.opId === opId);
  return performance.now() - start;
};

// ─── Sections ────────────────────────────────────────────────────────────────

const runCacheStatsSection = async (room) => {
  console.log('\n── cache_stats ──');

  // Cold snapshot (before route_get loop)
  const before = await fetchStats('/api/cluster/cache-stats');
  console.log(`cache_before requests=${before.requestCount} hits=${before.hitCount} hit_rate=${(before.hitRate * 100).toFixed(1)}%`);

  // Run N sequential GETs — first miss fills cache, subsequent hits are served from Caffeine
  const latencies = [];
  for (let i = 0; i < routeRequests; i++) {
    const result = await getJson(`/api/rooms/${encodeURIComponent(room)}`);
    latencies.push(result.elapsed);
  }

  const after = await fetchStats('/api/cluster/cache-stats');
  const deltaReqs = after.requestCount - before.requestCount;
  const deltaHits = after.hitCount - before.hitCount;
  const deltaMisses = after.missCount - before.missCount;
  const deltaLoads = after.loadCount - before.loadCount;
  const deltaLoadMs = after.totalLoadMs - before.totalLoadMs;
  const avgLoadMs = deltaLoads > 0 ? (deltaLoadMs / deltaLoads).toFixed(2) : 'n/a';

  console.log(
    `route_get count=${routeRequests}` +
    ` avg=${(latencies.reduce((a, b) => a + b, 0) / latencies.length).toFixed(2)}ms` +
    ` p50=${percentile(latencies, 0.5).toFixed(2)}ms` +
    ` p95=${percentile(latencies, 0.95).toFixed(2)}ms`,
  );
  console.log(
    `cache_after requests=+${deltaReqs} hits=+${deltaHits} misses=+${deltaMisses}` +
    ` hit_rate=${(after.hitRate * 100).toFixed(1)}%` +
    ` db_loads=${deltaLoads} avg_load_ms=${avgLoadMs}`,
  );
};

const runQueueStatsSection = async (peer1, room) => {
  console.log('\n── queue_stats (sequential ops) ──');

  const before = await fetchStats('/api/cluster/queue-stats');
  console.log(
    `queue_before active_sessions=${before.activeSessions}` +
    ` queued=${before.totalQueuedMessages}` +
    ` transient_drops=${before.transientDrops}` +
    ` overload_disconnects=${before.overloadDisconnects}`,
  );

  const ackLatencies = [];
  const start = performance.now();
  for (let i = 1; i <= opCount; i++) {
    ackLatencies.push(await sendOpAndWaitAck(peer1, room, i));
  }
  const totalMs = performance.now() - start;

  const after = await fetchStats('/api/cluster/queue-stats');
  const deltaDrops = after.transientDrops - before.transientDrops;
  const deltaOL = after.overloadDisconnects - before.overloadDisconnects;

  console.log(
    `ws_ops count=${opCount}` +
    ` total=${totalMs.toFixed(2)}ms` +
    ` throughput=${(opCount / (totalMs / 1000)).toFixed(1)}ops/s` +
    ` ack_avg=${(ackLatencies.reduce((a, b) => a + b, 0) / ackLatencies.length).toFixed(2)}ms` +
    ` ack_p50=${percentile(ackLatencies, 0.5).toFixed(2)}ms` +
    ` ack_p95=${percentile(ackLatencies, 0.95).toFixed(2)}ms`,
  );
  console.log(
    `queue_after active_sessions=${after.activeSessions}` +
    ` queued=${after.totalQueuedMessages}` +
    ` transient_drops=+${deltaDrops}` +
    ` overload_disconnects=+${deltaOL}`,
  );

  return ackLatencies;
};

// Concurrent transient burst: N peers each fire `burstMessages` cursor + emoji
// messages as fast as possible. This is the scenario that exercises the drop /
// overload thresholds in SessionSendQueue.
const runTransientBurstSection = async (room, joinToken) => {
  console.log(`\n── transient_burst peers=${concurrentPeers} msgs_per_peer=${burstMessages} ──`);

  // Alternate between backend1 and backend2 to spread load across nodes
  const peers = Array.from({ length: concurrentPeers }, (_, i) =>
    new WsPeer(`${wsBase}/ws/backend${(i % 2) + 1}/collab`, `burst-user-${i}`),
  );

  await Promise.all(peers.map((p) => p.connect(room, joinToken)));
  console.log(`burst_peers_connected total=${peers.length}`);

  const before = await fetchStats('/api/cluster/queue-stats');

  // Sample queue length while the burst is in flight
  const queueSamples = [];
  const samplerHandle = setInterval(async () => {
    try {
      const s = await fetchStats('/api/cluster/queue-stats');
      queueSamples.push(s.totalQueuedMessages);
    } catch { /* ignore */ }
  }, 50);

  const burstStart = performance.now();
  await Promise.all(peers.map(async (peer) => {
    for (let i = 0; i < burstMessages; i++) {
      // Alternate cursor (transient) and emoji (transient)
      if (i % 5 === 4) {
        peer.send({
          type: 'room-emoji',
          msgId: crypto.randomUUID(),
          roomId: room,
          userId: peer.userId,
          emoji: ['😄', '👍', '🔥', '❤️'][i % 4],
        });
      } else {
        peer.send({
          type: 'cursor',
          msgId: crypto.randomUUID(),
          roomId: room,
          userId: peer.userId,
          x: (i * 7) % 1200,
          y: (i * 13) % 800,
        });
      }
    }
  }));
  const burstMs = performance.now() - burstStart;

  // Short settle window so queues drain before final snapshot
  await new Promise((resolve) => setTimeout(resolve, 500));
  clearInterval(samplerHandle);

  const after = await fetchStats('/api/cluster/queue-stats');
  const deltaDrops = after.transientDrops - before.transientDrops;
  const deltaOL = after.overloadDisconnects - before.overloadDisconnects;
  const totalSent = concurrentPeers * burstMessages;
  const peakQueue = queueSamples.length > 0 ? Math.max(...queueSamples) : 0;
  const avgQueue = queueSamples.length > 0
    ? (queueSamples.reduce((a, b) => a + b, 0) / queueSamples.length).toFixed(1)
    : '0';

  console.log(
    `burst_sent total=${totalSent} duration=${burstMs.toFixed(0)}ms` +
    ` rate=${(totalSent / (burstMs / 1000)).toFixed(0)}msg/s`,
  );
  console.log(
    `queue_peak=${peakQueue} queue_avg=${avgQueue}` +
    ` transient_drops=${deltaDrops} (${((deltaDrops / totalSent) * 100).toFixed(2)}%)` +
    ` overload_disconnects=${deltaOL}`,
  );
  if (deltaDrops === 0 && deltaOL === 0) {
    console.log('queue_health=OK (no drops under this load)');
  } else if (deltaOL > 0) {
    console.log(`queue_health=OVERLOAD (${deltaOL} sessions force-closed)`);
  } else {
    console.log(`queue_health=DEGRADED (transient drops only, no session loss)`);
  }

  // Count how many burst peers were force-disconnected by overload
  const forceClosed = peers.filter((p) => p.disconnected).length;
  if (forceClosed > 0) {
    console.log(`burst_peers_force_closed=${forceClosed}/${peers.length}`);
  }

  peers.forEach((p) => p.close());
};

// ─── Main ─────────────────────────────────────────────────────────────────────

const main = async () => {
  const health = await getJson('/api/health');
  const nodes = await getJson('/api/cluster/nodes');
  console.log(`health=${health.json.status} nodes=${nodes.json.nodes.map((n) => n.nodeId).join(',')}`);

  const room = await postJson('/api/rooms', {
    roomId,
    name: `Perf ${roomId}`,
    accessMode: 'public',
    permissionMode: 'edit',
    voiceEnabled: false,
  });
  console.log(`room=${room.roomId} routed=${room.wsUrl}`);

  // ── 1. Cache stats: cold → warm via repeated route GETs ─────────────────────
  await runCacheStatsSection(room.roomId);

  // ── 2. Queue stats: two peers, sequential reliable ops ──────────────────────
  const peer1 = new WsPeer(`${wsBase}/ws/backend1/collab`, 'perf-user-a');
  const peer2 = new WsPeer(`${wsBase}/ws/backend2/collab`, 'perf-user-b');
  await Promise.all([peer1.connect(room.roomId, room.joinToken), peer2.connect(room.roomId, room.joinToken)]);

  const crossNodePromise = peer2.waitFor((m) => m.type === 'op' && m.op?.shapeId === 'shape-main');
  const firstAck = await sendOpAndWaitAck(peer1, room.roomId, 0);
  await crossNodePromise;
  console.log(`\n── cross_node ──\nws_cross_node ok first_ack=${firstAck.toFixed(2)}ms`);

  await runQueueStatsSection(peer1, room.roomId);

  peer1.close();
  peer2.close();

  // ── 3. Transient burst: N concurrent peers fire cursor/emoji at full speed ──
  await runTransientBurstSection(room.roomId, room.joinToken);

  // ── 4. History ──────────────────────────────────────────────────────────────
  console.log('\n── history ──');
  const historyPath = `/api/rooms/${encodeURIComponent(room.roomId)}/history${historyAt ? `?at=${historyAt}` : ''}`;
  const history = await getJson(historyPath);
  console.log(`history snapshot=${history.json.snapshot.snapshotId} ops=${history.json.ops.length} latency=${history.elapsed.toFixed(2)}ms`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

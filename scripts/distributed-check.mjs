const baseUrl = process.env.COCANVAS_BASE_URL ?? 'http://localhost:8088';
const wsBase = process.env.COCANVAS_WS_BASE ?? 'ws://localhost:8088';
const roomId = process.env.COCANVAS_ROOM_ID ?? `perf${Date.now().toString(36)}`;
const opCount = Number(process.env.COCANVAS_OPS ?? 300);
const routeRequests = Number(process.env.COCANVAS_ROUTE_REQUESTS ?? 300);
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

class WsPeer {
  constructor(url, userId) {
    this.url = url;
    this.userId = userId;
    this.messages = [];
    this.waiters = [];
    this.socket = null;
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
    this.socket.send(JSON.stringify(message));
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

const main = async () => {
  const health = await getJson('/api/health');
  const nodes = await getJson('/api/cluster/nodes');
  console.log(`health=${health.json.status} nodes=${nodes.json.nodes.map((node) => node.nodeId).join(',')}`);

  const room = await postJson('/api/rooms', {
    roomId,
    name: `Perf ${roomId}`,
    accessMode: 'public',
    permissionMode: 'edit',
    voiceEnabled: false,
  });
  console.log(`room=${room.roomId} routed=${room.wsUrl}`);

  const routeLatencies = [];
  for (let index = 0; index < routeRequests; index += 1) {
    const result = await getJson(`/api/rooms/${encodeURIComponent(roomId)}`);
    routeLatencies.push(result.elapsed);
  }
  console.log(`route_get count=${routeRequests} avg=${(routeLatencies.reduce((a, b) => a + b, 0) / routeLatencies.length).toFixed(2)}ms p50=${percentile(routeLatencies, 0.5).toFixed(2)}ms p95=${percentile(routeLatencies, 0.95).toFixed(2)}ms`);

  const peer1 = new WsPeer(`${wsBase}/ws/backend1/collab`, 'perf-user-a');
  const peer2 = new WsPeer(`${wsBase}/ws/backend2/collab`, 'perf-user-b');
  await Promise.all([peer1.connect(roomId, room.joinToken), peer2.connect(roomId, room.joinToken)]);

  const crossNodePromise = peer2.waitFor((message) => message.type === 'op' && message.op?.shapeId === 'shape-main');
  const firstAck = await sendOpAndWaitAck(peer1, roomId, 0);
  await crossNodePromise;
  console.log(`ws_cross_node ok first_ack=${firstAck.toFixed(2)}ms`);

  const ackLatencies = [];
  const start = performance.now();
  for (let index = 1; index <= opCount; index += 1) {
    ackLatencies.push(await sendOpAndWaitAck(peer1, roomId, index));
  }
  const totalMs = performance.now() - start;
  console.log(`ws_ops count=${opCount} total=${totalMs.toFixed(2)}ms throughput=${(opCount / (totalMs / 1000)).toFixed(1)}ops/s ack_avg=${(ackLatencies.reduce((a, b) => a + b, 0) / ackLatencies.length).toFixed(2)}ms ack_p50=${percentile(ackLatencies, 0.5).toFixed(2)}ms ack_p95=${percentile(ackLatencies, 0.95).toFixed(2)}ms`);

  const historyPath = `/api/rooms/${encodeURIComponent(roomId)}/history${historyAt ? `?at=${historyAt}` : ''}`;
  const history = await getJson(historyPath);
  console.log(`history snapshot=${history.json.snapshot.snapshotId} ops=${history.json.ops.length} latency=${history.elapsed.toFixed(2)}ms`);

  peer1.close();
  peer2.close();
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

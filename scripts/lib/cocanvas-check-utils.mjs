// Shared helpers for standalone Cocanvas validation scripts.
// The scripts target a running Docker Compose stack at localhost:8088 by default.
if (typeof WebSocket === 'undefined') {
  const { createRequire } = await import('module');
  const require = createRequire(import.meta.url);
  const WsImpl = require('ws');
  globalThis.WebSocket = WsImpl;
}

export const baseUrl = process.env.COCANVAS_BASE_URL ?? 'http://localhost:8088';
export const wsBase = process.env.COCANVAS_WS_BASE ?? 'ws://localhost:8088';

export const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const uniqueId = (prefix) => `${prefix}-${Date.now().toString(36)}-${crypto.randomUUID().slice(0, 8)}`;

export const percentile = (values, p) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
};

export const getJson = async (path) => {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`);
  const elapsedMs = performance.now() - startedAt;
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return { json: await response.json(), elapsedMs };
};

export const postJson = async (path, body, headers = {}) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`${path} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

export const createRoom = async (overrides = {}) => {
  const roomId = overrides.roomId ?? uniqueId('check');
  return postJson('/api/rooms', {
    roomId,
    name: `Check ${roomId}`,
    accessMode: 'link',
    permissionMode: 'edit',
    voiceEnabled: false,
    ...overrides,
    roomId,
  });
};

export class WsPeer {
  constructor(url, userId) {
    this.url = url;
    this.userId = userId;
    this.messages = [];
    this.waiters = [];
    this.socket = null;
    this.closed = false;
  }

  async open() {
    this.socket = new WebSocket(this.url);
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
      this.closed = true;
    });

    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`connect timeout ${this.url}`)), 10_000);
      this.socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      this.socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error(`connect error ${this.url}`));
      }, { once: true });
    });
  }

  async connect(roomId, joinToken, profile = {}) {
    await this.open();
    this.send({
      type: 'join',
      msgId: crypto.randomUUID(),
      roomId,
      userId: this.userId,
      displayName: profile.displayName ?? this.userId,
      color: profile.color ?? '#2563eb',
      joinToken,
    });
    await this.waitFor((message) => message.type === 'joined');
  }

  send(message) {
    if (!this.closed) {
      this.socket.send(JSON.stringify(message));
    }
  }

  waitFor(predicate, timeoutMs = 10_000) {
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

export const connectExpectJoinError = async (url, roomId, joinToken, expectedCode) => {
  const peer = new WsPeer(url, `bad-join-${crypto.randomUUID().slice(0, 8)}`);
  await peer.open();
  peer.send({
    type: 'join',
    msgId: crypto.randomUUID(),
    roomId,
    userId: peer.userId,
    displayName: peer.userId,
    color: '#be123c',
    joinToken,
  });
  const error = await peer.waitFor((message) => message.type === 'error', 5_000);
  peer.close();
  if (error.code !== expectedCode) {
    throw new Error(`expected ${expectedCode}, got ${error.code}`);
  }
  return error;
};

export const sendOpAndWait = async (peer, roomId, op, expected = 'op-ack') => {
  peer.send({
    type: 'op',
    msgId: crypto.randomUUID(),
    roomId,
    userId: peer.userId,
    hlc: `${Date.now()}.0.${peer.userId}`,
    op,
  });
  if (expected === 'op-ack') {
    return peer.waitFor((message) => message.type === 'op-ack' && message.opId === op.opId);
  }
  return peer.waitFor((message) => message.type === 'error' && message.code === expected);
};

export const poll = async (label, fn, timeoutMs = 5_000, intervalMs = 100) => {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const result = await fn();
      if (result) {
        return result;
      }
    } catch (error) {
      lastError = error;
    }
    await delay(intervalMs);
  }
  throw new Error(`${label} timed out${lastError ? `: ${lastError.message}` : ''}`);
};

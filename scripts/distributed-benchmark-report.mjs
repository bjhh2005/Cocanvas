import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  baseUrl,
  createRoom,
  delay,
  getJson,
  percentile,
  uniqueId,
  wsBase,
  WsPeer,
} from './lib/cocanvas-check-utils.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const outputDir = path.resolve(
  repoRoot,
  process.env.COCANVAS_BENCHMARK_OUTPUT_DIR ?? 'artifacts/distributed-benchmark',
);
const progressLogPath = path.join(outputDir, 'latest-run.log');

const config = {
  label: process.env.COCANVAS_BENCHMARK_LABEL ?? 'local-distributed-benchmark',
  routeRequests: Number(process.env.COCANVAS_BENCHMARK_ROUTE_REQUESTS ?? 80),
  sequentialOps: Number(process.env.COCANVAS_BENCHMARK_SEQUENTIAL_OPS ?? 60),
  burstPeers: Number(process.env.COCANVAS_BENCHMARK_BURST_PEERS ?? 6),
  burstMessages: Number(process.env.COCANVAS_BENCHMARK_BURST_MESSAGES ?? 40),
  historyRequests: Number(process.env.COCANVAS_BENCHMARK_HISTORY_REQUESTS ?? 10),
};

const timestampSlug = () => {
  const now = new Date();
  const yyyy = String(now.getFullYear());
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const hh = String(now.getHours()).padStart(2, '0');
  const mi = String(now.getMinutes()).padStart(2, '0');
  const ss = String(now.getSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
};

const average = (values) => (
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length
);

const summarizeLatencies = (values) => ({
  count: values.length,
  minMs: values.length === 0 ? 0 : Math.min(...values),
  maxMs: values.length === 0 ? 0 : Math.max(...values),
  avgMs: average(values),
  p50Ms: percentile(values, 0.5),
  p95Ms: percentile(values, 0.95),
  p99Ms: percentile(values, 0.99),
});

const round = (value, digits = 2) => Number(value.toFixed(digits));

const csvEscape = (value) => {
  const text = String(value ?? '');
  return /[,"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

const logProgress = async (message) => {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  await appendFile(progressLogPath, line, 'utf8');
  console.log(message);
};

const fetchStats = async (pathName) => {
  const response = await fetch(`${baseUrl}${pathName}`);
  if (!response.ok) {
    throw new Error(`${pathName} failed: ${response.status} ${await response.text()}`);
  }
  return response.json();
};

const nowHlc = (nodeId, counter) => `${Date.now()}.${counter}.${nodeId}`;

const makeReliableOp = (index, userId) => {
  const opId = `${userId}-op-${index}-${crypto.randomUUID()}`;
  const text = index === 0 ? 'benchmark-seed' : `benchmark-op-${index}`;
  return {
    opId,
    text,
    shapeId: 'benchmark-shape-main',
    message: {
      type: 'op',
      msgId: crypto.randomUUID(),
      roomId: null,
      userId,
      hlc: nowHlc(userId, index),
      op: {
        opId,
        opType: index === 0 ? 'create' : 'update',
        shapeId: 'benchmark-shape-main',
        shapeType: 'rect',
        attrs: index === 0
          ? { x: 80, y: 80, w: 120, h: 72, fill: '#93c5fd', text }
          : { x: 80 + index, y: 80 + index, text },
      },
    },
  };
};

const sendOpAndMeasureAck = async (peer, roomId, index) => {
  const opMeta = makeReliableOp(index, peer.userId);
  const startedAt = performance.now();
  peer.send({
    ...opMeta.message,
    roomId,
  });
  await peer.waitFor((message) => message.type === 'op-ack' && message.opId === opMeta.opId);
  return { elapsedMs: performance.now() - startedAt, ...opMeta };
};

const parseHistoryPayload = (payload) => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

const sameHistoryView = (left, right) => (
  left.actualOps === right.actualOps
  && left.lastOpId === right.lastOpId
  && left.lastOpText === right.lastOpText
);

const runRouteBenchmark = async (roomId) => {
  const before = await fetchStats('/api/cluster/cache-stats');
  const latencies = [];

  for (let index = 0; index < config.routeRequests; index += 1) {
    const { elapsedMs } = await getJson(`/api/rooms/${encodeURIComponent(roomId)}`);
    latencies.push(elapsedMs);
  }

  const after = await fetchStats('/api/cluster/cache-stats');
  return {
    requests: config.routeRequests,
    latency: summarizeLatencies(latencies),
    cacheBefore: before,
    cacheAfter: after,
    cacheDelta: {
      requestCount: after.requestCount - before.requestCount,
      hitCount: after.hitCount - before.hitCount,
      missCount: after.missCount - before.missCount,
      loadCount: after.loadCount - before.loadCount,
      totalLoadMs: after.totalLoadMs - before.totalLoadMs,
      hitRate: after.hitRate,
    },
  };
};

const runReliableWsBenchmark = async (roomId, joinToken) => {
  const queueBefore = await fetchStats('/api/cluster/queue-stats');
  const peerA = new WsPeer(`${wsBase}/ws/backend1/collab`, 'benchmark-user-a');
  const peerB = new WsPeer(`${wsBase}/ws/backend2/collab`, 'benchmark-user-b');

  await Promise.all([peerA.connect(roomId, joinToken), peerB.connect(roomId, joinToken)]);

  const firstOpStart = performance.now();
  const fanoutPromise = peerB.waitFor(
    (message) => message.type === 'op' && message.op?.shapeId === 'benchmark-shape-main',
  ).then(() => performance.now() - firstOpStart);
  const firstOp = await sendOpAndMeasureAck(peerA, roomId, 0);
  const firstAckMs = firstOp.elapsedMs;
  const firstFanoutMs = await fanoutPromise;

  const ackLatencies = [];
  let lastOp = firstOp;
  const startedAt = performance.now();
  for (let index = 1; index <= config.sequentialOps; index += 1) {
    const current = await sendOpAndMeasureAck(peerA, roomId, index);
    ackLatencies.push(current.elapsedMs);
    lastOp = current;
  }
  const totalMs = performance.now() - startedAt;
  const finalFanout = await peerB.waitFor(
    (message) => message.type === 'op' && message.op?.opId === lastOp.opId,
  );

  peerA.close();
  peerB.close();
  await delay(200);

  const queueAfter = await fetchStats('/api/cluster/queue-stats');
  return {
    firstAckMs,
    firstFanoutMs,
    opCount: config.sequentialOps + 1,
    totalMs,
    throughputOpsPerSecond: (config.sequentialOps + 1) / (totalMs / 1000),
    ackLatency: summarizeLatencies([firstAckMs, ...ackLatencies]),
    lastOp: {
      opId: lastOp.opId,
      shapeId: lastOp.shapeId,
      text: lastOp.text,
    },
    consistency: {
      firstCrossNodeDelivered: firstFanoutMs > 0,
      finalCrossNodeDelivered: finalFanout?.op?.opId === lastOp.opId,
    },
    queueBefore,
    queueAfter,
    queueDelta: {
      activeSessions: queueAfter.activeSessions - queueBefore.activeSessions,
      totalQueuedMessages: queueAfter.totalQueuedMessages - queueBefore.totalQueuedMessages,
      transientDrops: queueAfter.transientDrops - queueBefore.transientDrops,
      overloadDisconnects: queueAfter.overloadDisconnects - queueBefore.overloadDisconnects,
    },
  };
};

const runTransientBurstBenchmark = async (roomId, joinToken) => {
  const peers = Array.from({ length: config.burstPeers }, (_, index) => (
    new WsPeer(`${wsBase}/ws/backend${(index % 2) + 1}/collab`, `burst-user-${index}`)
  ));
  for (const peer of peers) {
    await peer.connect(roomId, joinToken);
    await delay(50);
  }

  const queueBefore = await fetchStats('/api/cluster/queue-stats');
  const queueSamples = [];
  const sampler = setInterval(async () => {
    try {
      const snapshot = await fetchStats('/api/cluster/queue-stats');
      queueSamples.push(snapshot.totalQueuedMessages);
    } catch {
      queueSamples.push(0);
    }
  }, 50);

  const totalSent = config.burstPeers * config.burstMessages;
  const startedAt = performance.now();
  await Promise.all(peers.map(async (peer) => {
    for (let index = 0; index < config.burstMessages; index += 1) {
      if (index % 5 === 4) {
        peer.send({
          type: 'room-emoji',
          msgId: crypto.randomUUID(),
          roomId,
          userId: peer.userId,
          emoji: ['😄', '👍', '🔥', '❤️'][index % 4],
        });
      } else {
        peer.send({
          type: 'cursor',
          msgId: crypto.randomUUID(),
          roomId,
          userId: peer.userId,
          x: (index * 7) % 1200,
          y: (index * 13) % 800,
        });
      }
    }
  }));
  const totalMs = performance.now() - startedAt;

  await delay(700);
  clearInterval(sampler);
  const disconnectedPeers = peers.filter((peer) => peer.closed).length;
  peers.forEach((peer) => peer.close());

  const queueAfter = await fetchStats('/api/cluster/queue-stats');
  return {
    peers: config.burstPeers,
    messagesPerPeer: config.burstMessages,
    totalSent,
    totalMs,
    throughputMessagesPerSecond: totalSent / (totalMs / 1000),
    peakQueuedMessages: queueSamples.length === 0 ? 0 : Math.max(...queueSamples),
    avgQueuedMessages: average(queueSamples),
    queueBefore,
    queueAfter,
    queueDelta: {
      activeSessions: queueAfter.activeSessions - queueBefore.activeSessions,
      totalQueuedMessages: queueAfter.totalQueuedMessages - queueBefore.totalQueuedMessages,
      transientDrops: queueAfter.transientDrops - queueBefore.transientDrops,
      overloadDisconnects: queueAfter.overloadDisconnects - queueBefore.overloadDisconnects,
    },
    disconnectedPeers,
  };
};

const pollHistoryRoom = async (roomId, expectedMinOps) => {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const { json } = await getJson(`/api/rooms/${encodeURIComponent(roomId)}/history`);
    if (json.ops.length >= expectedMinOps) {
      return json;
    }
    await delay(200);
  }
  throw new Error(`history poll timed out before reaching ${expectedMinOps} ops`);
};

const summarizeHistoryView = (historyResponse) => {
  const parsedOps = historyResponse.ops
    .map((op) => ({ raw: op, parsed: parseHistoryPayload(op.payload) }))
    .filter((item) => item.parsed);
  const lastParsed = parsedOps.at(-1);
  return {
    actualOps: historyResponse.ops.length,
    lastOpId: lastParsed?.parsed?.opId ?? '',
    lastOpText: lastParsed?.parsed?.attrs?.text ?? '',
    opIds: parsedOps.map((item) => item.parsed.opId).filter(Boolean),
    texts: parsedOps
      .map((item) => item.parsed.attrs?.text)
      .filter((value) => typeof value === 'string' && value.length > 0),
  };
};

const runHistoryBenchmark = async (roomId, expectedMinOps, expectedLastOp) => {
  const snapshot = await pollHistoryRoom(roomId, expectedMinOps);
  const anchors = await fetchStats(`/api/rooms/${encodeURIComponent(roomId)}/history/anchors`);
  const historyLatencies = [];
  const anchorLatencies = [];
  const historyViews = [];

  for (let index = 0; index < config.historyRequests; index += 1) {
    const historyResult = await getJson(`/api/rooms/${encodeURIComponent(roomId)}/history`);
    historyLatencies.push(historyResult.elapsedMs);
    historyViews.push(summarizeHistoryView(historyResult.json));
    const anchorsResult = await getJson(`/api/rooms/${encodeURIComponent(roomId)}/history/anchors`);
    anchorLatencies.push(anchorsResult.elapsedMs);
  }

  const baselineView = historyViews[0] ?? summarizeHistoryView(snapshot);
  const stableReads = historyViews.every((view) => sameHistoryView(view, baselineView));
  const persistedLastOp = baselineView.opIds.includes(expectedLastOp.opId);
  const persistedLastText = baselineView.texts.includes(expectedLastOp.text);

  return {
    expectedMinOps,
    actualOps: snapshot.ops.length,
    snapshotId: snapshot.snapshot.snapshotId,
    latestOpAt: anchors.latestOpAt,
    snapshotCount: anchors.snapshots.length,
    lastOpId: baselineView.lastOpId,
    lastOpText: baselineView.lastOpText,
    consistency: {
      containsExpectedLastOp: persistedLastOp,
      containsExpectedLastText: persistedLastText,
      stableRepeatedReads: stableReads,
    },
    historyLatency: summarizeLatencies(historyLatencies),
    anchorLatency: summarizeLatencies(anchorLatencies),
  };
};

const buildMarkdownReport = (report) => `# 分布式基准测试报告

- 测试标签：\`${report.meta.label}\`
- 开始时间：\`${report.meta.startedAt}\`
- 结束时间：\`${report.meta.finishedAt}\`
- HTTP 入口：\`${report.meta.baseUrl}\`
- WebSocket 入口：\`${report.meta.wsBase}\`
- 测试房间：\`${report.meta.roomId}\`
- 集群节点：\`${report.meta.nodes.map((node) => node.nodeId).join(', ')}\`

## 测试负载

| 场景 | 配置 |
| --- | --- |
| 路由读取 | ${report.config.routeRequests} 次 GET /rooms/{id} |
| 可靠写入 | ${report.config.sequentialOps + 1} 次 websocket op |
| 瞬时流量 | ${report.config.burstPeers} 个 peer，每个 ${report.config.burstMessages} 条 transient 消息 |
| 历史查询 | ${report.config.historyRequests} 次 /history 与 /history/anchors |

## 核心指标

| 指标 | 数值 |
| --- | ---: |
| 路由读取平均延迟 | ${round(report.routeReads.latency.avgMs)} ms |
| 路由读取 p95 | ${round(report.routeReads.latency.p95Ms)} ms |
| 缓存命中率 | ${round(report.routeReads.cacheAfter.hitRate * 100)} % |
| 首次写入 ack | ${round(report.reliableWs.firstAckMs)} ms |
| 首次跨节点 fanout | ${round(report.reliableWs.firstFanoutMs)} ms |
| 可靠写入吞吐 | ${round(report.reliableWs.throughputOpsPerSecond)} ops/s |
| 可靠写入 ack p95 | ${round(report.reliableWs.ackLatency.p95Ms)} ms |
| burst 吞吐 | ${round(report.transientBurst.throughputMessagesPerSecond)} msg/s |
| burst 队列峰值 | ${report.transientBurst.peakQueuedMessages} |
| transient 丢弃数 | ${report.transientBurst.queueDelta.transientDrops} |
| overload 断连数 | ${report.transientBurst.queueDelta.overloadDisconnects} |
| history 平均延迟 | ${round(report.historyReads.historyLatency.avgMs)} ms |
| history p95 | ${round(report.historyReads.historyLatency.p95Ms)} ms |
| anchors 平均延迟 | ${round(report.historyReads.anchorLatency.avgMs)} ms |
| 持久化操作数 | ${report.historyReads.actualOps} |

## 一致性校验

| 检查项 | 结果 |
| --- | --- |
| 首次跨节点消息送达 | ${report.reliableWs.consistency.firstCrossNodeDelivered ? '通过' : '失败'} |
| 最后一条跨节点消息送达 | ${report.reliableWs.consistency.finalCrossNodeDelivered ? '通过' : '失败'} |
| history 中包含最终操作 | ${report.historyReads.consistency.containsExpectedLastOp ? '通过' : '失败'} |
| history 中包含最终文本 | ${report.historyReads.consistency.containsExpectedLastText ? '通过' : '失败'} |
| 重复读取 history 结果稳定 | ${report.historyReads.consistency.stableRepeatedReads ? '通过' : '失败'} |

## 结果解读

- 路由读取场景使用脚本自动创建的测试房间，用于观察路由查询与缓存命中情况。
- 可靠写入场景固定从 \`backend1\` 发消息、由 \`backend2\` 接收，从而验证跨节点传播和 ack 延迟。
- 瞬时流量场景只发送 cursor / emoji 等 transient 消息，用于观察队列峰值、丢弃和过载保护。
- 历史查询场景复用同一个测试房间，因此性能指标和一致性校验都建立在真实写入数据之上。
`;

const toCsvRow = (report) => {
  const cells = [
    report.meta.startedAt,
    report.meta.label,
    report.meta.roomId,
    report.meta.nodes.map((node) => node.nodeId).join('|'),
    report.config.routeRequests,
    round(report.routeReads.latency.avgMs),
    round(report.routeReads.latency.p95Ms),
    round(report.routeReads.cacheAfter.hitRate * 100),
    report.reliableWs.opCount,
    round(report.reliableWs.firstAckMs),
    round(report.reliableWs.firstFanoutMs),
    round(report.reliableWs.throughputOpsPerSecond),
    round(report.reliableWs.ackLatency.p95Ms),
    report.reliableWs.consistency.firstCrossNodeDelivered,
    report.reliableWs.consistency.finalCrossNodeDelivered,
    report.transientBurst.totalSent,
    round(report.transientBurst.throughputMessagesPerSecond),
    report.transientBurst.peakQueuedMessages,
    report.transientBurst.queueDelta.transientDrops,
    report.transientBurst.queueDelta.overloadDisconnects,
    report.historyReads.actualOps,
    report.historyReads.consistency.containsExpectedLastOp,
    report.historyReads.consistency.containsExpectedLastText,
    report.historyReads.consistency.stableRepeatedReads,
    round(report.historyReads.historyLatency.avgMs),
    round(report.historyReads.historyLatency.p95Ms),
    round(report.historyReads.anchorLatency.avgMs),
  ];
  return cells.map(csvEscape).join(',');
};

const appendHistoryCsv = async (report) => {
  const csvPath = path.join(outputDir, 'benchmark-history.csv');
  const header = [
    'started_at',
    'label',
    'room_id',
    'nodes',
    'route_requests',
    'route_avg_ms',
    'route_p95_ms',
    'cache_hit_rate_pct',
    'reliable_ops',
    'first_ack_ms',
    'first_fanout_ms',
    'reliable_throughput_ops_per_s',
    'reliable_ack_p95_ms',
    'cross_node_first_ok',
    'cross_node_final_ok',
    'burst_messages',
    'burst_throughput_msg_per_s',
    'burst_peak_queue',
    'burst_transient_drops',
    'burst_overload_disconnects',
    'history_ops',
    'history_has_last_op',
    'history_has_last_text',
    'history_repeated_reads_stable',
    'history_avg_ms',
    'history_p95_ms',
    'history_anchor_avg_ms',
  ].join(',');

  let hasExistingHeader = false;
  try {
    const existing = await readFile(csvPath, 'utf8');
    hasExistingHeader = existing.startsWith('started_at,');
  } catch {
    hasExistingHeader = false;
  }

  if (!hasExistingHeader) {
    await writeFile(csvPath, `${header}\n${toCsvRow(report)}\n`, 'utf8');
    return csvPath;
  }

  await appendFile(csvPath, `${toCsvRow(report)}\n`, 'utf8');
  return csvPath;
};

const main = async () => {
  await mkdir(outputDir, { recursive: true });
  await writeFile(progressLogPath, '', 'utf8');
  const startedAt = new Date();
  const runSlug = timestampSlug();

  await logProgress('stage=health');
  const health = await fetchStats('/api/health');
  const clusterNodes = await fetchStats('/api/cluster/nodes');
  await logProgress(`stage=create_room nodes=${clusterNodes.nodes.map((node) => node.nodeId).join(',')}`);
  const room = await createRoom({
    roomId: uniqueId('bench'),
    name: `Distributed Benchmark ${runSlug}`,
    accessMode: 'public',
    permissionMode: 'edit',
    voiceEnabled: false,
  });

  await logProgress(`stage=route_reads room=${room.roomId}`);
  const routeReads = await runRouteBenchmark(room.roomId);
  await logProgress(`stage=reliable_ws room=${room.roomId}`);
  const reliableWs = await runReliableWsBenchmark(room.roomId, room.joinToken);
  await logProgress(`stage=transient_burst room=${room.roomId}`);
  const transientBurst = await runTransientBurstBenchmark(room.roomId, room.joinToken);
  await logProgress(`stage=history_reads room=${room.roomId}`);
  const historyReads = await runHistoryBenchmark(room.roomId, reliableWs.opCount, reliableWs.lastOp);
  const finishedAt = new Date();

  const report = {
    meta: {
      label: config.label,
      runSlug,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      baseUrl,
      wsBase,
      roomId: room.roomId,
      roomWsUrl: room.wsUrl,
      nodes: clusterNodes.nodes,
      health,
    },
    config,
    routeReads,
    reliableWs,
    transientBurst,
    historyReads,
  };

  const jsonText = `${JSON.stringify(report, null, 2)}\n`;
  const markdownText = buildMarkdownReport(report);
  const csvHeader = [
    'started_at',
    'label',
    'room_id',
    'nodes',
    'route_requests',
    'route_avg_ms',
    'route_p95_ms',
    'cache_hit_rate_pct',
    'reliable_ops',
    'first_ack_ms',
    'first_fanout_ms',
    'reliable_throughput_ops_per_s',
    'reliable_ack_p95_ms',
    'cross_node_first_ok',
    'cross_node_final_ok',
    'burst_messages',
    'burst_throughput_msg_per_s',
    'burst_peak_queue',
    'burst_transient_drops',
    'burst_overload_disconnects',
    'history_ops',
    'history_has_last_op',
    'history_has_last_text',
    'history_repeated_reads_stable',
    'history_avg_ms',
    'history_p95_ms',
    'history_anchor_avg_ms',
  ].join(',');
  const csvText = `${csvHeader}\n${toCsvRow(report)}\n`;

  const jsonPath = path.join(outputDir, `benchmark-${runSlug}.json`);
  const mdPath = path.join(outputDir, `benchmark-${runSlug}.md`);
  const csvPath = path.join(outputDir, `benchmark-${runSlug}.csv`);

  await writeFile(jsonPath, jsonText, 'utf8');
  await writeFile(mdPath, markdownText, 'utf8');
  await writeFile(csvPath, csvText, 'utf8');
  await writeFile(path.join(outputDir, 'latest.json'), jsonText, 'utf8');
  await writeFile(path.join(outputDir, 'latest.md'), markdownText, 'utf8');
  await writeFile(path.join(outputDir, 'latest.csv'), csvText, 'utf8');
  const historyCsvPath = await appendHistoryCsv(report);

  await logProgress(`stage=done room=${room.roomId}`);
  console.log(`benchmark_room=${room.roomId}`);
  console.log(`benchmark_json=${jsonPath}`);
  console.log(`benchmark_markdown=${mdPath}`);
  console.log(`benchmark_csv=${csvPath}`);
  console.log(`benchmark_history_csv=${historyCsvPath}`);
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

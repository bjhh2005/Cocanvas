import {
  createRoom,
  getJson,
  poll,
  sendOpAndWait,
  uniqueId,
  wsBase,
  WsPeer,
} from './lib/cocanvas-check-utils.mjs';

const run = async () => {
  const room = await createRoom({ roomId: uniqueId('history-anchors') });
  const peer = new WsPeer(`${wsBase}/ws/backend1/collab`, 'history-anchor-user');
  await peer.connect(room.roomId, room.joinToken);

  const opId = uniqueId('history-op');
  await sendOpAndWait(peer, room.roomId, {
    opId,
    opType: 'create',
    shapeId: uniqueId('shape'),
    shapeType: 'rect',
    attrs: { x: 180, y: 180, w: 180, h: 96, fill: '#bfdbfe' },
  });
  peer.close();

  const anchors = await poll('history anchors', async () => {
    const { json } = await getJson(`/api/rooms/${encodeURIComponent(room.roomId)}/history/anchors`);
    return json.latestOpAt >= room.createdAt ? json : null;
  }, 8_000, 200);

  const history = await poll('history payload', async () => {
    const { json } = await getJson(`/api/rooms/${encodeURIComponent(room.roomId)}/history`);
    return json.ops.some((op) => op.opId === opId) ? json : null;
  }, 8_000, 200);

  console.log(`history_anchors roomCreatedAt=${anchors.roomCreatedAt} latestOpAt=${anchors.latestOpAt} snapshots=${anchors.snapshots.length}`);
  console.log(`history ops=${history.ops.length} contains_op=${opId}`);
  console.log('history_anchors_check=OK');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

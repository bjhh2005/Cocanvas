import {
  createRoom,
  sendOpAndWait,
  uniqueId,
  wsBase,
  WsPeer,
} from './lib/cocanvas-check-utils.mjs';

const makeOp = (shapeType, opId = uniqueId('op')) => ({
  opId,
  opType: 'create',
  shapeId: uniqueId(shapeType),
  shapeType,
  attrs: shapeType === 'comment'
    ? { x: 120, y: 120, w: 220, h: 90, text: 'permission check' }
    : { x: 120, y: 120, w: 160, h: 90, fill: '#dbeafe' },
});

const run = async () => {
  const scenarios = [
    { permissionMode: 'view', shapeType: 'rect', expected: 'permission_denied' },
    { permissionMode: 'comment', shapeType: 'rect', expected: 'permission_denied' },
    { permissionMode: 'comment', shapeType: 'comment', expected: 'op-ack' },
    { permissionMode: 'edit', shapeType: 'rect', expected: 'op-ack' },
  ];

  for (const scenario of scenarios) {
    const room = await createRoom({
      roomId: uniqueId(`perm-${scenario.permissionMode}`),
      permissionMode: scenario.permissionMode,
    });
    const peer = new WsPeer(`${wsBase}/ws/backend1/collab`, `perm-user-${scenario.permissionMode}`);
    await peer.connect(room.roomId, room.joinToken);
    const result = await sendOpAndWait(peer, room.roomId, makeOp(scenario.shapeType), scenario.expected);
    peer.close();
    console.log(`permission ${scenario.permissionMode}/${scenario.shapeType}: ${result.type}${result.code ? ` ${result.code}` : ''}`);
  }

  console.log('permission_check=OK');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

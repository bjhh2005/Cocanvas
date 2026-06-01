import {
  connectExpectJoinError,
  createRoom,
  uniqueId,
  wsBase,
  WsPeer,
} from './lib/cocanvas-check-utils.mjs';

const mutateToken = (token) => {
  const index = Math.max(0, token.length - 2);
  return `${token.slice(0, index)}${token[index] === 'a' ? 'b' : 'a'}${token.slice(index + 1)}`;
};

const run = async () => {
  const room = await createRoom({ roomId: uniqueId('join-token') });
  const peer = new WsPeer(`${wsBase}/ws/backend1/collab`, 'join-token-valid-user');

  await peer.connect(room.roomId, room.joinToken);
  peer.close();
  console.log('join_token valid: joined');

  await connectExpectJoinError(`${wsBase}/ws/backend1/collab`, room.roomId, '', 'invalid_join_token');
  console.log('join_token blank: rejected');

  await connectExpectJoinError(`${wsBase}/ws/backend1/collab`, room.roomId, mutateToken(room.joinToken), 'invalid_join_token');
  console.log('join_token tampered: rejected');

  const otherRoom = await createRoom({ roomId: uniqueId('join-token-other') });
  await connectExpectJoinError(`${wsBase}/ws/backend1/collab`, otherRoom.roomId, room.joinToken, 'invalid_join_token');
  console.log('join_token wrong_room: rejected');

  console.log('join_token_check=OK');
};

run().catch((error) => {
  console.error(error);
  process.exit(1);
});

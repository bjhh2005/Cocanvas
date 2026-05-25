export type PeerInfo = {
  userId: string;
  displayName: string;
  color: string;
};

export type JoinMessage = {
  type: 'join';
  msgId: string;
  roomId: string;
  userId: string;
  displayName: string;
  color: string;
};

export type CursorMessage = {
  type: 'cursor';
  msgId: string;
  roomId: string;
  userId: string;
  x: number;
  y: number;
};

export type ShapeType = 'rect' | 'circle' | 'text';
export type OpType = 'create' | 'update' | 'delete';

export type ShapeAttrs = {
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  radius?: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  text?: string;
};

export type ShapeOperation = {
  opType: OpType;
  shapeId: string;
  shapeType: ShapeType;
  hlc?: string;
  writerId?: string;
  attrs?: ShapeAttrs;
};

export type OpMessage = {
  type: 'op';
  msgId: string;
  roomId: string;
  userId: string;
  hlc: string;
  op: ShapeOperation;
};

export type ClientMessage = JoinMessage | CursorMessage | OpMessage;

export type JoinedMessage = {
  type: 'joined';
  roomId: string;
  you: PeerInfo;
  peers: PeerInfo[];
};

export type PeerJoinedMessage = {
  type: 'peer-joined';
  userId: string;
  displayName: string;
  color: string;
};

export type PeerLeftMessage = {
  type: 'peer-left';
  userId: string;
};

export type CursorBroadcastMessage = {
  type: 'cursor';
  userId: string;
  displayName?: string;
  color?: string;
  x: number;
  y: number;
};

export type OpBroadcastMessage = {
  type: 'op';
  userId: string;
  hlc: string;
  op: ShapeOperation;
};

export type ErrorMessage = {
  type: 'error';
  code: string;
  message: string;
};

export type ServerMessage =
  | JoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | CursorBroadcastMessage
  | OpBroadcastMessage
  | ErrorMessage;

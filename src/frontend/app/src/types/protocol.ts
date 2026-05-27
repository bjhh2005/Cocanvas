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

export type ShapeType =
  | 'rect'
  | 'roundedRect'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'text'
  | 'sticky'
  | 'connector'
  | 'pen'
  | 'comment'
  | 'frame';
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
  textColor?: string;
  fontSize?: number;
  fontStyle?: string;
  cornerRadius?: number;
  zIndex?: number;
  fromShapeId?: string;
  toShapeId?: string;
  fromAnchor?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  toAnchor?: 'top' | 'right' | 'bottom' | 'left' | 'center';
  arrowEnd?: boolean;
  points?: number[];
  authorId?: string;
  authorName?: string;
  resolved?: boolean;
};

export type ShapeOperation = {
  opId?: string;
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

export type ShapePreviewMessage = {
  type: 'shape-preview';
  msgId: string;
  roomId: string;
  userId: string;
  op: ShapeOperation;
};

export type ClientMessage = JoinMessage | CursorMessage | OpMessage | ShapePreviewMessage;

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

export type ShapePreviewBroadcastMessage = {
  type: 'shape-preview';
  userId: string;
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
  | ShapePreviewBroadcastMessage
  | ErrorMessage;

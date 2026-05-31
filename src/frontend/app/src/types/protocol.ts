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
  joinToken: string;
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
  | 'frame'
  | 'card';
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
  title?: string;
  body?: string;
  tags?: string[];
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  status?: 'idea' | 'todo' | 'doing' | 'done' | 'blocked';
  assignee?: string;
  votes?: number;
  voters?: string[];
  groupId?: string | null;
  groupName?: string | null;
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

export type RoomChatClientMessage = {
  type: 'room-chat';
  msgId: string;
  roomId: string;
  userId: string;
  displayName: string;
  color: string;
  text: string;
  timestamp: number;
};

export type RoomEmojiClientMessage = {
  type: 'room-emoji';
  msgId: string;
  roomId: string;
  userId: string;
  emoji: string;
};

export type RoomPhaseClientMessage = {
  type: 'room-phase';
  msgId: string;
  roomId: string;
  userId: string;
  phaseId: string;
};

export type RoomPhasesClientMessage = {
  type: 'room-phases';
  msgId: string;
  roomId: string;
  userId: string;
  phases: Array<{ id: string; label: string; hint: string; templateId: string }>;
};

export type ClientMessage = JoinMessage | CursorMessage | OpMessage | ShapePreviewMessage | RoomChatClientMessage | RoomEmojiClientMessage | RoomPhaseClientMessage | RoomPhasesClientMessage;

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

export type OpAckMessage = {
  type: 'op-ack';
  opId?: string;
  hlc: string;
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

export type RoomChatBroadcastMessage = {
  type: 'room-chat';
  userId: string;
  displayName: string;
  color: string;
  text: string;
  timestamp: number;
};

export type RoomEmojiBroadcastMessage = {
  type: 'room-emoji';
  userId: string;
  emoji: string;
};

export type RoomPhaseBroadcastMessage = {
  type: 'room-phase';
  userId: string;
  phaseId: string;
};

export type RoomPhasesBroadcastMessage = {
  type: 'room-phases';
  userId: string;
  phases: Array<{ id: string; label: string; hint: string; templateId: string }>;
};

export type ServerMessage =
  | JoinedMessage
  | PeerJoinedMessage
  | PeerLeftMessage
  | CursorBroadcastMessage
  | OpBroadcastMessage
  | OpAckMessage
  | ShapePreviewBroadcastMessage
  | RoomChatBroadcastMessage
  | RoomEmojiBroadcastMessage
  | RoomPhaseBroadcastMessage
  | RoomPhasesBroadcastMessage
  | ErrorMessage;

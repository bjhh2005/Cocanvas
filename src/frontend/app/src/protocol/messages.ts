// 与 backend/protocol 包对齐，字段定义见 src/protocol/messages.md

export interface UserInfo {
  userId: string
  displayName: string
  color: string
}

export interface Op {
  opType: 'create' | 'update' | 'delete'
  shapeId: string
  shapeType?: string
  attrs?: Record<string, unknown>
}

// ── 客户端 → 服务端 ───────────────────────────
export interface JoinMsg {
  type: 'join'
  msgId: string
  roomId: string
  userId: string
  displayName: string
  color: string
}

export interface CursorMsg {
  type: 'cursor'
  msgId: string
  roomId: string
  userId: string
  x: number
  y: number
}

export interface OpMsg {
  type: 'op'
  msgId: string
  roomId: string
  userId: string
  op: Op
}

export type InboundMessage = JoinMsg | CursorMsg | OpMsg

// ── 服务端 → 客户端 ───────────────────────────
export interface JoinedMsg {
  type: 'joined'
  roomId: string
  you: UserInfo
  peers: UserInfo[]
}

export interface PeerJoinedMsg {
  type: 'peer-joined'
  userId: string
  displayName: string
  color: string
}

export interface PeerLeftMsg {
  type: 'peer-left'
  userId: string
}

export interface CursorBcastMsg {
  type: 'cursor'
  userId: string
  x: number
  y: number
}

export interface OpBcastMsg {
  type: 'op'
  fromUserId: string
  hlc: string | null
  op: Op
}

export interface ErrorMsg {
  type: 'error'
  code: string
  message: string
  refMsgId?: string
}

export type OutboundMessage =
  | JoinedMsg
  | PeerJoinedMsg
  | PeerLeftMsg
  | CursorBcastMsg
  | OpBcastMsg
  | ErrorMsg

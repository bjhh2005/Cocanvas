export type CreateRoomResponse = {
  roomId: string;
  name: string;
  wsUrl: string;
  createdAt: number;
  accessMode: string;
  permissionMode: string;
  passwordProtected: boolean;
  voiceEnabled: boolean;
  joinToken: string;
  memberRole: string;
};

export type QueryRoomResponse = {
  roomId: string;
  exists: boolean;
  authorized: boolean;
  wsUrl: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  accessMode: string;
  permissionMode: string;
  passwordProtected: boolean;
  voiceEnabled: boolean;
  joinToken: string;
  memberRole: string;
};

export type RoomSummary = {
  roomId: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  accessMode: string;
  permissionMode: string;
  passwordProtected: boolean;
  voiceEnabled: boolean;
};

export type CreateRoomRequest = {
  roomId?: string;
  name?: string;
  accessMode: string;
  permissionMode: string;
  password?: string;
  voiceEnabled: boolean;
};

export type UpdateRoomRequest = {
  name: string;
  accessMode: string;
  permissionMode: string;
  password?: string;
  voiceEnabled: boolean;
};

export type AuthUser = {
  userId: string;
  username: string;
  displayName: string;
  color: string;
  authToken: string;
};

export type RoomMember = {
  userId: string;
  username: string;
  displayName: string;
  color: string;
  role: 'owner' | 'edit' | 'comment' | 'view';
  updatedAt: number;
};

export type HistoryResponse = {
  snapshot: {
    snapshotId: string;
    hlc: string;
    createdAt: number;
    payload: string;
  };
  ops: Array<{
    opId: string;
    userId: string;
    hlc: string;
    createdAt: number;
    payload: string;
  }>;
};

const authHeaders = (authToken?: string): HeadersInit => (
  authToken ? { Authorization: `Bearer ${authToken}` } : {}
);

export const fetchHealth = async () => {
  // 通过 Nginx 代理请求，使用相对路径 /api/... ，解决跨域与端口封闭的问题
  const response = await fetch('/api/health');
  if (!response.ok) {
    throw new Error('Network response was not ok');
  }
  return response.json();
};

export const listRooms = async (): Promise<RoomSummary[]> => {
  const response = await fetch('/api/rooms');
  if (!response.ok) {
    throw new Error('Failed to list rooms');
  }

  return response.json();
};

export const loginUser = async (
  username: string,
  password: string,
  displayName?: string,
  color?: string,
): Promise<AuthUser> => {
  return submitAuth('/api/auth/login', username, password, displayName, color, '登录失败');
};

export const registerUser = async (
  username: string,
  password: string,
  displayName?: string,
  color?: string,
): Promise<AuthUser> => {
  return submitAuth('/api/auth/register', username, password, displayName, color, '注册失败');
};

const submitAuth = async (
  url: string,
  username: string,
  password: string,
  displayName: string | undefined,
  color: string | undefined,
  fallbackMessage: string,
): Promise<AuthUser> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password, displayName, color }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? fallbackMessage);
  }

  return response.json();
};

export const createRoom = async (request?: CreateRoomRequest, authToken?: string): Promise<CreateRoomResponse> => {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(authToken) },
    body: JSON.stringify(request ?? {}),
  });
  if (!response.ok) {
    throw new Error('Failed to create room');
  }

  return response.json();
};

export const getRoom = async (roomId: string, password?: string, authToken?: string): Promise<QueryRoomResponse> => {
  const query = password ? `?password=${encodeURIComponent(password)}` : '';
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}${query}`, {
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    throw new Error('Failed to query room');
  }

  return response.json();
};

export const updateRoom = async (roomId: string, request: UpdateRoomRequest): Promise<RoomSummary> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw new Error('Failed to update room');
  }

  return response.json();
};

export const archiveRoom = async (roomId: string): Promise<void> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`, { method: 'DELETE' });
  if (!response.ok) {
    throw new Error('Failed to archive room');
  }
};

export const listRoomMembers = async (roomId: string): Promise<RoomMember[]> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members`);
  if (!response.ok) throw new Error('Failed to list room members');
  return response.json();
};

export const claimRoomOwner = async (roomId: string, authToken: string): Promise<RoomMember> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members/claim`, {
    method: 'POST',
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? '认领房间失败');
  }
  return response.json();
};

export const upsertRoomMember = async (
  roomId: string,
  request: { username?: string; userId?: string; role: RoomMember['role'] },
  authToken: string,
): Promise<RoomMember> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(authToken) },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? '保存成员失败');
  }
  return response.json();
};

export const removeRoomMember = async (roomId: string, userId: string, authToken: string): Promise<void> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE',
    headers: authHeaders(authToken),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(payload?.message ?? '移除成员失败');
  }
};

export const getRoomHistory = async (roomId: string, at?: number): Promise<HistoryResponse> => {
  const query = typeof at === 'number' ? `?at=${at}` : '';
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/history${query}`);
  if (!response.ok) {
    throw new Error('Failed to query history');
  }

  return response.json();
};

export type CacheStatsResponse = {
  requestCount: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  missRate: number;
  loadCount: number;
  totalLoadMs: number;
};

export type QueueStatsResponse = {
  activeSessions: number;
  totalQueuedMessages: number;
  transientDrops: number;
  overloadDisconnects: number;
};

export type HistoryAnchors = {
  roomCreatedAt: number;
  snapshots: number[];
  latestOpAt: number;
};

export const fetchHistoryAnchors = async (roomId: string): Promise<HistoryAnchors> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/history/anchors`);
  if (!response.ok) throw new Error('Failed to fetch history anchors');
  return response.json();
};

export const fetchCacheStats = async (): Promise<CacheStatsResponse> => {
  const response = await fetch('/api/cluster/cache-stats');
  if (!response.ok) throw new Error('Failed to fetch cache stats');
  return response.json();
};

export const fetchQueueStats = async (): Promise<QueueStatsResponse> => {
  const response = await fetch('/api/cluster/queue-stats');
  if (!response.ok) throw new Error('Failed to fetch queue stats');
  return response.json();
};

export type AiChatResponse = {
  message: string;
  ops: Array<Record<string, unknown>>;
};

export type AiSummaryResponse = {
  markdown: string;
};

const withTimeout = async (request: RequestInfo | URL, init: RequestInit, timeoutMs: number) => {
  const controller = new AbortController();
  const timer = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(request, { ...init, signal: controller.signal });
  } finally {
    globalThis.clearTimeout(timer);
  }
};

export const chatWithAi = async (
  roomId: string,
  prompt: string,
  boardContext: string,
): Promise<AiChatResponse> => {
  const response = await withTimeout(`/api/rooms/${encodeURIComponent(roomId)}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, boardContext }),
  }, 30_000);
  if (!response.ok) throw new Error('AI request failed');
  return response.json();
};

export const orchestrateWithAi = async (
  roomId: string,
  prompt: string,
  boardContext: string,
): Promise<AiChatResponse> => {
  const response = await withTimeout(`/api/rooms/${encodeURIComponent(roomId)}/ai/orchestrate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, boardContext }),
  }, 30_000);
  if (!response.ok) throw new Error('AI orchestration request failed');
  return response.json();
};

export const summarizeWithAi = async (
  roomId: string,
  prompt: string,
  boardContext: string,
): Promise<AiSummaryResponse> => {
  const response = await withTimeout(`/api/rooms/${encodeURIComponent(roomId)}/ai/summarize`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, boardContext }),
  }, 30_000);
  if (!response.ok) throw new Error('AI summary request failed');
  return response.json();
};

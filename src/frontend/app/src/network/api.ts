export type CreateRoomResponse = {
  roomId: string;
  name: string;
  wsUrl: string;
  createdAt: number;
  accessMode: string;
  permissionMode: string;
  passwordProtected: boolean;
  voiceEnabled: boolean;
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

export const createRoom = async (request?: CreateRoomRequest): Promise<CreateRoomResponse> => {
  const response = await fetch('/api/rooms', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request ?? {}),
  });
  if (!response.ok) {
    throw new Error('Failed to create room');
  }

  return response.json();
};

export const getRoom = async (roomId: string, password?: string): Promise<QueryRoomResponse> => {
  const query = password ? `?password=${encodeURIComponent(password)}` : '';
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}${query}`);
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

export const getRoomHistory = async (roomId: string, at: number): Promise<HistoryResponse> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/history?at=${at}`);
  if (!response.ok) {
    throw new Error('Failed to query history');
  }

  return response.json();
};

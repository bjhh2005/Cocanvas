export type CreateRoomResponse = {
  roomId: string;
  wsUrl: string;
  createdAt: number;
};

export type QueryRoomResponse = {
  roomId: string;
  exists: boolean;
  wsUrl: string;
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

export const createRoom = async (): Promise<CreateRoomResponse> => {
  const response = await fetch('/api/rooms', { method: 'POST' });
  if (!response.ok) {
    throw new Error('Failed to create room');
  }

  return response.json();
};

export const getRoom = async (roomId: string): Promise<QueryRoomResponse> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`);
  if (!response.ok) {
    throw new Error('Failed to query room');
  }

  return response.json();
};

export const getRoomHistory = async (roomId: string, at: number): Promise<HistoryResponse> => {
  const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/history?at=${at}`);
  if (!response.ok) {
    throw new Error('Failed to query history');
  }

  return response.json();
};

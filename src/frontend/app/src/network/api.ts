// 所有 HTTP 走 /api 相对路径（Nginx 转发；Vite 直连模式由 vite.config 的 proxy 处理）

export interface HealthResponse { status: string }

export const fetchHealth = async (): Promise<HealthResponse> => {
  const r = await fetch('/api/health')
  if (!r.ok) throw new Error('Network response was not ok')
  return r.json()
}

export interface CreateRoomResponse { roomId: string; wsUrl: string }

export const createRoom = async (): Promise<CreateRoomResponse> => {
  const r = await fetch('/api/rooms', { method: 'POST' })
  if (!r.ok) throw new Error('Failed to create room')
  return r.json()
}

export interface RoomInfoResponse { roomId: string; exists: boolean; wsUrl: string }

export const fetchRoom = async (roomId: string): Promise<RoomInfoResponse> => {
  const r = await fetch(`/api/rooms/${encodeURIComponent(roomId)}`)
  if (!r.ok) throw new Error('Room lookup failed')
  return r.json()
}

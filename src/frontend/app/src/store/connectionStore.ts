import { create } from 'zustand'

export type ConnectionStatus = 'idle' | 'connecting' | 'connected' | 'disconnected'

interface ConnectionState {
  status: ConnectionStatus
  roomId: string | null
  // 自己的身份，join 成功后由服务端 joined 消息确认
  userId: string | null
  displayName: string | null
  color: string | null

  setStatus: (s: ConnectionStatus) => void
  setIdentity: (i: { userId: string; displayName: string; color: string }) => void
  setRoomId: (roomId: string | null) => void
  reset: () => void
}

export const useConnectionStore = create<ConnectionState>((set) => ({
  status: 'idle',
  roomId: null,
  userId: null,
  displayName: null,
  color: null,

  setStatus: (status) => set({ status }),
  setIdentity: ({ userId, displayName, color }) => set({ userId, displayName, color }),
  setRoomId: (roomId) => set({ roomId }),
  reset: () => set({ status: 'idle', roomId: null }),
}))

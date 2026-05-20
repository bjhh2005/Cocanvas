import { create } from 'zustand'

export interface PeerState {
  userId: string
  displayName: string
  color: string
  x: number
  y: number
  // 服务端最后一次更新本地时间戳，用于陈旧光标清理（后续阶段）
  updatedAt: number
}

interface UserState {
  peers: Record<string, PeerState>

  upsertPeerMeta: (p: { userId: string; displayName: string; color: string }) => void
  updatePeerCursor: (userId: string, x: number, y: number) => void
  removePeer: (userId: string) => void
  reset: () => void
}

export const useUserStore = create<UserState>((set) => ({
  peers: {},

  upsertPeerMeta: ({ userId, displayName, color }) =>
    set((s) => ({
      peers: {
        ...s.peers,
        [userId]: {
          ...(s.peers[userId] ?? { x: -9999, y: -9999, updatedAt: 0 }),
          userId,
          displayName,
          color,
        },
      },
    })),

  updatePeerCursor: (userId, x, y) =>
    set((s) => {
      const prev = s.peers[userId]
      if (!prev) {
        // 收到 cursor 但还没收到 peer-joined（罕见竞态）：用占位元信息建一个
        return {
          peers: {
            ...s.peers,
            [userId]: { userId, displayName: userId, color: '#888', x, y, updatedAt: Date.now() },
          },
        }
      }
      return {
        peers: { ...s.peers, [userId]: { ...prev, x, y, updatedAt: Date.now() } },
      }
    }),

  removePeer: (userId) =>
    set((s) => {
      if (!s.peers[userId]) return s
      const next = { ...s.peers }
      delete next[userId]
      return { peers: next }
    }),

  reset: () => set({ peers: {} }),
}))

import { create } from 'zustand';
import type { PeerInfo } from '../types/protocol';

type RemotePeer = PeerInfo & {
  x: number;
  y: number;
};

type UserState = {
  userId: string;
  displayName: string;
  color: string;
  remotes: Record<string, RemotePeer>;
  addPeer: (peer: PeerInfo) => void;
  removePeer: (userId: string) => void;
  setPeers: (peers: PeerInfo[]) => void;
  updateCursor: (userId: string, x: number, y: number, displayName?: string, color?: string) => void;
};

const palette = ['#e85d75', '#1f9a8a', '#f59f00', '#3772ff', '#7c3aed', '#ef7b45'];

const createUserId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `u-${Math.random().toString(16).slice(2)}`;
};

const createUserProfile = () => {
  const userId = createUserId();
  const color = palette[Math.floor(Math.random() * palette.length)];
  const displayName = `User ${userId.slice(0, 4)}`;
  return { userId, color, displayName };
};

const profile = createUserProfile();

export const useUserStore = create<UserState>((set) => ({
  ...profile,
  remotes: {},
  addPeer: (peer) => set((state) => ({
    remotes: {
      ...state.remotes,
      [peer.userId]: {
        ...peer,
        x: state.remotes[peer.userId]?.x ?? 0,
        y: state.remotes[peer.userId]?.y ?? 0,
      },
    },
  })),
  removePeer: (userId) => set((state) => {
    const next = { ...state.remotes };
    delete next[userId];
    return { remotes: next };
  }),
  setPeers: (peers) => set(() => ({
    remotes: Object.fromEntries(peers.map((peer) => [peer.userId, { ...peer, x: 0, y: 0 }])),
  })),
  updateCursor: (userId, x, y, displayName, color) => set((state) => {
    const existing = state.remotes[userId];
    if (!existing) {
      return {
        remotes: {
          ...state.remotes,
          [userId]: {
            userId,
            displayName: displayName ?? `User ${userId.slice(0, 4)}`,
            color: color ?? '#3772ff',
            x,
            y,
          },
        },
      };
    }

    return {
      remotes: {
        ...state.remotes,
        [userId]: { ...existing, x, y },
      },
    };
  }),
}));

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
  setDisplayName: (displayName: string) => void;
  setColor: (color: string) => void;
  addPeer: (peer: PeerInfo) => void;
  removePeer: (userId: string) => void;
  setPeers: (peers: PeerInfo[]) => void;
  updateCursor: (userId: string, x: number, y: number, displayName?: string, color?: string) => void;
};

export const userPalette = ['#e85d75', '#1f9a8a', '#f59f00', '#3772ff', '#7c3aed', '#ef7b45'];
const profileStorageKey = 'cocanvas:user-profile';

const createUserId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `u-${Math.random().toString(16).slice(2)}`;
};

const createUserProfile = () => {
  const userId = createUserId();
  const color = userPalette[Math.floor(Math.random() * userPalette.length)];
  const displayName = `User ${userId.slice(0, 4)}`;
  return { userId, color, displayName };
};

const loadUserProfile = () => {
  const fallback = createUserProfile();
  if (typeof localStorage === 'undefined') {
    return fallback;
  }

  try {
    const stored = JSON.parse(localStorage.getItem(profileStorageKey) ?? '{}') as Partial<typeof fallback>;
    return {
      userId: stored.userId || fallback.userId,
      displayName: stored.displayName || fallback.displayName,
      color: stored.color || fallback.color,
    };
  } catch {
    return fallback;
  }
};

const saveUserProfile = (profile: { userId: string; displayName: string; color: string }) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(profileStorageKey, JSON.stringify(profile));
};

const profile = loadUserProfile();

export const useUserStore = create<UserState>((set) => ({
  ...profile,
  remotes: {},
  setDisplayName: (displayName) => set((state) => {
    const next = { ...state, displayName: displayName.trim() || state.displayName };
    saveUserProfile({ userId: next.userId, displayName: next.displayName, color: next.color });
    return { displayName: next.displayName };
  }),
  setColor: (color) => set((state) => {
    const next = { ...state, color };
    saveUserProfile({ userId: next.userId, displayName: next.displayName, color: next.color });
    return { color };
  }),
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
        [userId]: {
          ...existing,
          displayName: displayName ?? existing.displayName,
          color: color ?? existing.color,
          x,
          y,
        },
      },
    };
  }),
}));

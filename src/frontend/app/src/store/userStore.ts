import { create } from 'zustand';
import type { AuthUser } from '../network/api';
import type { PeerInfo } from '../types/protocol';

type RemotePeer = PeerInfo & {
  x: number;
  y: number;
};

type CursorUpdate = {
  userId: string;
  x: number;
  y: number;
  displayName?: string;
  color?: string;
};

type UserState = {
  userId: string;
  username: string;
  authToken: string;
  displayName: string;
  color: string;
  remotes: Record<string, RemotePeer>;
  setAccount: (account: AuthUser) => void;
  clearAccount: () => void;
  setDisplayName: (displayName: string) => void;
  setColor: (color: string) => void;
  addPeer: (peer: PeerInfo) => void;
  removePeer: (userId: string) => void;
  setPeers: (peers: PeerInfo[]) => void;
  updateCursor: (userId: string, x: number, y: number, displayName?: string, color?: string) => void;
  updateCursors: (updates: CursorUpdate[]) => void;
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
  return { userId, username: '', authToken: '', color, displayName };
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
      username: stored.username || '',
      authToken: stored.authToken || '',
      displayName: stored.displayName || fallback.displayName,
      color: stored.color || fallback.color,
    };
  } catch {
    return fallback;
  }
};

const saveUserProfile = (profile: { userId: string; username: string; authToken: string; displayName: string; color: string }) => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(profileStorageKey, JSON.stringify(profile));
};

const profile = loadUserProfile();

export const useUserStore = create<UserState>((set) => ({
  ...profile,
  remotes: {},
  setAccount: (account) => set(() => {
    const next = {
      userId: account.userId,
      username: account.username,
      authToken: account.authToken,
      displayName: account.displayName,
      color: account.color,
    };
    saveUserProfile(next);
    return next;
  }),
  clearAccount: () => set((state) => {
    const fallback = createUserProfile();
    const next = {
      userId: fallback.userId,
      username: '',
      authToken: '',
      displayName: state.displayName || fallback.displayName,
      color: state.color || fallback.color,
    };
    saveUserProfile(next);
    return next;
  }),
  setDisplayName: (displayName) => set((state) => {
    const next = { ...state, displayName: displayName.trim() || state.displayName };
    saveUserProfile({ userId: next.userId, username: next.username, authToken: next.authToken, displayName: next.displayName, color: next.color });
    return { displayName: next.displayName };
  }),
  setColor: (color) => set((state) => {
    const next = { ...state, color };
    saveUserProfile({ userId: next.userId, username: next.username, authToken: next.authToken, displayName: next.displayName, color });
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
  updateCursors: (updates) => set((state) => {
    if (updates.length === 0) {
      return state;
    }

    let changed = false;
    const nextRemotes = { ...state.remotes };
    updates.forEach(({ userId, x, y, displayName, color }) => {
      const existing = nextRemotes[userId];
      if (!existing) {
        nextRemotes[userId] = {
          userId,
          displayName: displayName ?? `User ${userId.slice(0, 4)}`,
          color: color ?? '#3772ff',
          x,
          y,
        };
        changed = true;
        return;
      }

      const nextDisplayName = displayName ?? existing.displayName;
      const nextColor = color ?? existing.color;
      if (
        existing.x === x &&
        existing.y === y &&
        existing.displayName === nextDisplayName &&
        existing.color === nextColor
      ) {
        return;
      }

      nextRemotes[userId] = {
        ...existing,
        displayName: nextDisplayName,
        color: nextColor,
        x,
        y,
      };
      changed = true;
    });

    return changed ? { remotes: nextRemotes } : state;
  }),
}));

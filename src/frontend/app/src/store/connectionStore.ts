import { create } from 'zustand';
import { WSClient, type WSStatus } from '../network/websocket';

type ConnectionState = {
  roomId: string | null;
  status: WSStatus;
  wsClient: WSClient | null;
  setRoomId: (roomId: string | null) => void;
  setStatus: (status: WSStatus) => void;
  setClient: (client: WSClient | null) => void;
};

export const useConnectionStore = create<ConnectionState>((set) => ({
  roomId: null,
  status: 'idle',
  wsClient: null,
  setRoomId: (roomId) => set({ roomId }),
  setStatus: (status) => set({ status }),
  setClient: (wsClient) => set({ wsClient }),
}));

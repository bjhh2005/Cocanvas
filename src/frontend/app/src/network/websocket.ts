import type { ClientMessage } from '../types/protocol';

type MessageHandler = (data: string) => void;
type StatusHandler = (status: WSStatus) => void;

export type WSStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

export class WSClient {
  private socket: WebSocket | null = null;
  private messageHandlers = new Set<MessageHandler>();
  private statusHandlers = new Set<StatusHandler>();
  private status: WSStatus = 'idle';
  private readonly url: string;

  constructor(url: string) {
    this.url = url;
  }

  connect() {
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      return;
    }

    this.setStatus('connecting');
    this.socket = new WebSocket(this.url);

    this.socket.addEventListener('open', () => {
      this.setStatus('connected');
    });

    this.socket.addEventListener('message', (event) => {
      this.messageHandlers.forEach((handler) => handler(String(event.data)));
    });

    this.socket.addEventListener('close', () => {
      this.setStatus('closed');
    });

    this.socket.addEventListener('error', () => {
      this.setStatus('error');
    });
  }

  send(data: string) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected');
    }

    this.socket.send(data);
  }

  sendJson(data: ClientMessage) {
    this.send(JSON.stringify(data));
  }

  getStatus() {
    return this.status;
  }

  onMessage(handler: MessageHandler) {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }

  onStatusChange(handler: StatusHandler) {
    this.statusHandlers.add(handler);
    handler(this.status);
    return () => this.statusHandlers.delete(handler);
  }

  close() {
    this.socket?.close();
    this.socket = null;
  }

  private setStatus(status: WSStatus) {
    this.status = status;
    this.statusHandlers.forEach((handler) => handler(status));
  }
}

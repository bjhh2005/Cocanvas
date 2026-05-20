// 原生 WebSocket 封装：模块单例，**不放 React state**
// 组件通过 onMessage 订阅，store 通过 setState 反映状态

import type { InboundMessage, OutboundMessage } from '../protocol/messages'

type Status = 'idle' | 'connecting' | 'connected' | 'disconnected'
type StatusListener = (s: Status) => void
type MessageListener = (msg: OutboundMessage) => void

export class WSClient {
  private ws: WebSocket | null = null
  private status: Status = 'idle'
  private statusListeners = new Set<StatusListener>()
  private messageListeners = new Set<MessageListener>()
  private url = ''

  connect(url: string): void {
    if (this.ws && (this.status === 'connecting' || this.status === 'connected')) return
    this.url = url
    this.setStatus('connecting')
    const ws = new WebSocket(url)
    this.ws = ws

    // staleness 守卫：StrictMode/重连场景下，老 ws 的异步事件不能影响当前 this.ws
    const isCurrent = () => this.ws === ws

    ws.onopen = () => {
      if (!isCurrent()) return
      this.setStatus('connected')
    }
    ws.onclose = () => {
      if (!isCurrent()) return
      this.ws = null
      this.setStatus('disconnected')
    }
    ws.onerror = () => {
      if (!isCurrent()) return
      this.setStatus('disconnected')
    }
    ws.onmessage = (e) => {
      if (!isCurrent()) return
      let parsed: OutboundMessage
      try { parsed = JSON.parse(e.data) as OutboundMessage } catch { return }
      this.messageListeners.forEach(l => l(parsed))
    }
  }

  send(msg: InboundMessage): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false
    this.ws.send(JSON.stringify(msg))
    return true
  }

  close(): void {
    // 先置空，让旧 ws 上后到的 onopen/onclose 命中 staleness 守卫被忽略
    const old = this.ws
    this.ws = null
    this.setStatus('idle')
    old?.close()
  }

  getStatus(): Status { return this.status }
  getUrl(): string { return this.url }

  onStatus(listener: StatusListener): () => void {
    this.statusListeners.add(listener)
    return () => this.statusListeners.delete(listener)
  }

  onMessage(listener: MessageListener): () => void {
    this.messageListeners.add(listener)
    return () => this.messageListeners.delete(listener)
  }

  private setStatus(s: Status): void {
    if (this.status === s) return
    this.status = s
    this.statusListeners.forEach(l => l(s))
  }
}

// 整个应用共享一个实例
export const wsClient = new WSClient()

// Docker 模式：通过 Nginx 走相对路径；
// Vite 直连（5173）改为 ws://${location.hostname}:8080/ws/collab
export const COLLAB_WS_URL = `ws://${location.host}/ws/collab`

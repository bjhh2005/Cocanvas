import { useEffect, useMemo, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import HeaderBar from '../components/HeaderBar'
import CursorOverlay from '../components/CursorOverlay'
import Canvas from '../components/Canvas'
import Toolbar from '../components/Toolbar'
import PropertiesPanel from '../components/PropertiesPanel'
import { COLLAB_WS_URL, wsClient } from '../network/websocket'
import { getIdentity, hasIdentity } from '../utils/identity'
import { throttle } from '../utils/throttle'
import { useConnectionStore } from '../store/connectionStore'
import { useUserStore } from '../store/userStore'
import { useShapeStore } from '../store/shapeStore'
import type { OutboundMessage } from '../protocol/messages'
import './Room.css'

export default function Room() {
  const { roomId = '' } = useParams<{ roomId: string }>()
  const navigate = useNavigate()

  const setStatus   = useConnectionStore(s => s.setStatus)
  const setIdentity = useConnectionStore(s => s.setIdentity)
  const setRoomId   = useConnectionStore(s => s.setRoomId)
  const reset       = useConnectionStore(s => s.reset)

  const userUpsert  = useUserStore(s => s.upsertPeerMeta)
  const userMove    = useUserStore(s => s.updatePeerCursor)
  const userRemove  = useUserStore(s => s.removePeer)
  const userReset   = useUserStore(s => s.reset)

  const shapeReset  = useShapeStore(s => s.reset)
  const selectedId  = useShapeStore(s => s.selectedId)

  const identity = useMemo(() => getIdentity(), [])

  // Redirect to home if no identity set (direct URL access without going through Home)
  useEffect(() => {
    if (!hasIdentity()) {
      navigate(`/?room=${roomId}`, { replace: true })
    }
  }, [navigate, roomId])

  const sendCursor = useMemo(
    () =>
      throttle((x: number, y: number) => {
        wsClient.send({
          type: 'cursor',
          msgId: crypto.randomUUID(),
          roomId,
          userId: identity.userId,
          x,
          y,
        })
      }, 50),
    [roomId, identity],
  )

  const workspaceRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!roomId) return
    setRoomId(roomId)
    setIdentity(identity)

    const offStatus = wsClient.onStatus(setStatus)
    const offMsg = wsClient.onMessage((msg: OutboundMessage) => {
      switch (msg.type) {
        case 'joined': {
          msg.peers.forEach(p => userUpsert(p))
          break
        }
        case 'peer-joined': {
          userUpsert({ userId: msg.userId, displayName: msg.displayName, color: msg.color })
          break
        }
        case 'peer-left': {
          userRemove(msg.userId)
          break
        }
        case 'cursor': {
          userMove(msg.userId, msg.x, msg.y)
          break
        }
        case 'op': {
          // Backend excludes the sender, so every op we receive is from a peer
          useShapeStore.getState().applyOp(msg.op)
          break
        }
        case 'error': {
          console.warn('[ws error]', msg.code, msg.message)
          break
        }
      }
    })

    wsClient.connect(COLLAB_WS_URL)

    const offForJoin = wsClient.onStatus((s) => {
      if (s !== 'connected') return
      wsClient.send({
        type: 'join',
        msgId: crypto.randomUUID(),
        roomId,
        userId: identity.userId,
        displayName: identity.displayName,
        color: identity.color,
      })
      offForJoin()
    })

    return () => {
      offStatus()
      offMsg()
      offForJoin()
      wsClient.close()
      userReset()
      shapeReset()
      reset()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  // Delete / Backspace removes the selected shape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const tag = (e.target as HTMLElement).tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      const { selectedId } = useShapeStore.getState()
      if (!selectedId) return
      e.preventDefault()
      const op = { opType: 'delete' as const, shapeId: selectedId }
      useShapeStore.getState().applyOp(op)
      wsClient.send({ type: 'op', msgId: crypto.randomUUID(), roomId, userId: identity.userId, op })
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [roomId, identity])

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    sendCursor(e.clientX, e.clientY)
  }

  return (
    <div className="room-page">
      <HeaderBar roomId={roomId} />

      <div
        ref={workspaceRef}
        className="room-workspace"
        onMouseMove={handleMouseMove}
      >
        <div className="room-canvas-grid" aria-hidden />
        <Canvas />
        <Toolbar />
        {selectedId && <PropertiesPanel key={selectedId} />}
      </div>

      <CursorOverlay />
    </div>
  )
}

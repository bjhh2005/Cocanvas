import { useNavigate } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import { useConnectionStore } from '../store/connectionStore'
import { useUserStore } from '../store/userStore'
import './HeaderBar.css'

const STATUS_TEXT: Record<string, string> = {
  idle: '未连接',
  connecting: '连接中…',
  connected: '已连接',
  disconnected: '已断开',
}

export default function HeaderBar({ roomId }: { roomId: string }) {
  const navigate = useNavigate()
  const status = useConnectionStore(s => s.status)
  const selfUserId      = useConnectionStore(s => s.userId)
  const selfDisplayName = useConnectionStore(s => s.displayName)
  const selfColor       = useConnectionStore(s => s.color)
  const peers = useUserStore(useShallow(s => Object.values(s.peers)))

  const dotClass = status === 'connected' ? 'green'
    : status === 'connecting' ? 'amber'
      : status === 'disconnected' ? 'red' : 'gray'

  async function copyRoomId() {
    try { await navigator.clipboard.writeText(roomId) } catch { /* ignore */ }
  }

  // 自己也算一个头像
  const avatars = selfUserId
    ? [{ userId: selfUserId, displayName: selfDisplayName ?? '?', color: selfColor ?? '#888', isSelf: true }, ...peers.map(p => ({ ...p, isSelf: false }))]
    : peers.map(p => ({ ...p, isSelf: false }))

  return (
    <header className="hb">
      <div className="hb-left">
        <button className="hb-icon-btn" onClick={() => navigate('/')} title="返回首页">←</button>
        <span className="hb-room-label">Room</span>
        <code className="hb-room-id">{roomId}</code>
        <button className="hb-icon-btn" onClick={copyRoomId} title="复制房间 ID">⧉</button>
      </div>

      <div className="hb-right">
        <span className="hb-status">
          <span className={`hb-dot hb-dot-${dotClass}`} />
          {STATUS_TEXT[status]}
        </span>
        <div className="hb-peers">
          {avatars.map(a => (
            <span
              key={a.userId}
              className={`hb-avatar ${a.isSelf ? 'hb-avatar-self' : ''}`}
              style={{ background: a.color }}
              title={a.displayName + (a.isSelf ? '（你）' : '')}
            >
              {a.displayName.charAt(0).toUpperCase()}
            </span>
          ))}
        </div>
      </div>
    </header>
  )
}

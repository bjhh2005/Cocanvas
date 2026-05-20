import { useShallow } from 'zustand/react/shallow'
import { useUserStore } from '../store/userStore'
import './CursorOverlay.css'

// 远端光标层：绝对定位的 DOM，pointer-events: none 不阻挡画布交互
// 用 CSS transition 做 80ms 线性补间，弥补 50ms 节流的离散感
export default function CursorOverlay() {
  const peers = useUserStore(useShallow(s => Object.values(s.peers)))

  return (
    <div className="cursor-overlay" aria-hidden>
      {peers.map(p => (
        <div
          key={p.userId}
          className="cursor-item"
          style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
        >
          <svg width="22" height="22" viewBox="0 0 22 22" style={{ color: p.color }}>
            <path
              d="M3 2 L3 18 L8 14 L11 20 L13.5 19 L10.5 13 L17 13 Z"
              fill="currentColor"
              stroke="#fff"
              strokeWidth="1.3"
            />
          </svg>
          <span className="cursor-label" style={{ background: p.color }}>
            {p.displayName}
          </span>
        </div>
      ))}
    </div>
  )
}

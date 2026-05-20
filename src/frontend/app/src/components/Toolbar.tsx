import { useShapeStore } from '../store/shapeStore'
import { useConnectionStore } from '../store/connectionStore'
import { wsClient } from '../network/websocket'
import './Toolbar.css'

export default function Toolbar() {
  const applyOp = useShapeStore(s => s.applyOp)
  const roomId  = useConnectionStore(s => s.roomId) ?? ''
  const userId  = useConnectionStore(s => s.userId) ?? ''

  function addShape(shapeType: 'rect' | 'circle' | 'text') {
    const shapeId = crypto.randomUUID()
    // Spread new shapes around the center so they don't stack
    const cx = Math.floor(window.innerWidth / 2 - 50 + Math.random() * 100)
    const cy = Math.floor(window.innerHeight / 2 - 50 + Math.random() * 100)

    const attrs: Record<string, unknown> =
      shapeType === 'rect'
        ? { x: cx, y: cy, w: 100, h: 80, fill: '#3498db' }
        : shapeType === 'circle'
        ? { x: cx, y: cy, radius: 50, fill: '#e74c3c' }
        : { x: cx, y: cy, text: '文本', fill: '#2c3e50', fontSize: 18 }

    const op = { opType: 'create' as const, shapeId, shapeType, attrs }
    applyOp(op)
    wsClient.send({ type: 'op', msgId: crypto.randomUUID(), roomId, userId, op })
  }

  return (
    <div className="toolbar">
      <button className="tb-btn" onClick={() => addShape('rect')} title="添加矩形">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
        </svg>
        <span>矩形</span>
      </button>
      <button className="tb-btn" onClick={() => addShape('circle')} title="添加圆形">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <circle cx="8" cy="8" r="5.5" />
        </svg>
        <span>圆形</span>
      </button>
      <button className="tb-btn" onClick={() => addShape('text')} title="添加文本">
        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M3 4h10M8 4v8M5.5 12h5" strokeLinecap="round" />
        </svg>
        <span>文本</span>
      </button>
    </div>
  )
}

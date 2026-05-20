import { useRef } from 'react'
import { useShapeStore, type TextShape } from '../store/shapeStore'
import { useConnectionStore } from '../store/connectionStore'
import { wsClient } from '../network/websocket'
import './PropertiesPanel.css'

export default function PropertiesPanel() {
  const selectedId = useShapeStore(s => s.selectedId)
  const shapes     = useShapeStore(s => s.shapes)
  const applyOp    = useShapeStore(s => s.applyOp)
  const roomId     = useConnectionStore(s => s.roomId) ?? ''
  const userId     = useConnectionStore(s => s.userId) ?? ''

  const shape = selectedId ? shapes[selectedId] : null
  if (!shape) return null

  const textInputRef = useRef<HTMLInputElement>(null)

  function sendUpdate(attrs: Record<string, unknown>) {
    const op = { opType: 'update' as const, shapeId: shape!.shapeId, attrs }
    applyOp(op)
    wsClient.send({ type: 'op', msgId: crypto.randomUUID(), roomId, userId, op })
  }

  function sendDelete() {
    const op = { opType: 'delete' as const, shapeId: shape!.shapeId }
    applyOp(op)
    wsClient.send({ type: 'op', msgId: crypto.randomUUID(), roomId, userId, op })
  }

  const label = shape.shapeType === 'rect' ? '矩形' : shape.shapeType === 'circle' ? '圆形' : '文本'
  const textShape = shape.shapeType === 'text' ? (shape as TextShape) : null

  return (
    <div className="pp">
      <p className="pp-title">{label}</p>

      <label className="pp-row">
        <span>填充</span>
        <input
          type="color"
          className="pp-color"
          value={shape.fill}
          onChange={e => sendUpdate({ fill: e.target.value })}
        />
      </label>

      {textShape && (
        <label className="pp-row">
          <span>内容</span>
          <input
            ref={textInputRef}
            className="pp-text-input"
            type="text"
            defaultValue={textShape.text}
            onBlur={e => {
              const v = e.currentTarget.value.trim()
              if (v && v !== textShape.text) sendUpdate({ text: v })
            }}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
        </label>
      )}

      {textShape && (
        <label className="pp-row">
          <span>字号</span>
          <div className="pp-stepper">
            <button onClick={() => sendUpdate({ fontSize: Math.max(8, textShape.fontSize - 2) })}>−</button>
            <span>{textShape.fontSize}</span>
            <button onClick={() => sendUpdate({ fontSize: Math.min(144, textShape.fontSize + 2) })}>+</button>
          </div>
        </label>
      )}

      <button className="pp-delete" onClick={sendDelete}>删除</button>
    </div>
  )
}

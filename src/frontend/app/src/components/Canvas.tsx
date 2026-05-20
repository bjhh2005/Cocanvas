import { useEffect, useRef, useState } from 'react'
import { Stage, Layer, Rect, Circle, Text, Transformer } from 'react-konva'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useShapeStore, type TextShape } from '../store/shapeStore'
import { useConnectionStore } from '../store/connectionStore'
import { wsClient } from '../network/websocket'
import { throttle } from '../utils/throttle'
import './Canvas.css'

export default function Canvas() {
  const wrapRef        = useRef<HTMLDivElement>(null)
  const stageRef       = useRef<Konva.Stage>(null)
  const transformerRef = useRef<Konva.Transformer>(null)
  const textAreaRef    = useRef<HTMLTextAreaElement>(null)
  const [size, setSize] = useState({ w: window.innerWidth, h: window.innerHeight })
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    const obs = new ResizeObserver(([entry]) => {
      if (entry) setSize({ w: entry.contentRect.width, h: entry.contentRect.height })
    })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  const shapes     = useShapeStore(s => s.shapes)
  const selectedId = useShapeStore(s => s.selectedId)
  const setSelected = useShapeStore(s => s.setSelected)

  const roomIdRef = useRef('')
  const userIdRef = useRef('')
  roomIdRef.current = useConnectionStore(s => s.roomId) ?? ''
  userIdRef.current = useConnectionStore(s => s.userId) ?? ''

  // Attach Transformer to selected node (clear when editing text inline)
  useEffect(() => {
    const tr = transformerRef.current
    if (!tr) return
    if (selectedId && !editingId) {
      const stage = stageRef.current
      const node = stage?.findOne<Konva.Node>('#' + selectedId)
      if (node) {
        tr.nodes([node])
        tr.getLayer()?.batchDraw()
        return
      }
    }
    tr.nodes([])
    tr.getLayer()?.batchDraw()
  }, [selectedId, editingId, shapes])

  // Focus textarea when entering edit mode
  useEffect(() => {
    if (editingId) textAreaRef.current?.focus()
  }, [editingId])

  // ── Op helpers ───────────────────────────────────────────────────────────
  function sendOp(op: Parameters<ReturnType<typeof useShapeStore>['applyOp']>[0]) {
    wsClient.send({
      type: 'op',
      msgId: crypto.randomUUID(),
      roomId: roomIdRef.current,
      userId: userIdRef.current,
      op,
    })
  }

  // ── Per-shape throttled drag handler ─────────────────────────────────────
  const dragHandlersRef = useRef<Record<string, (x: number, y: number) => void>>({})
  function getDragHandler(shapeId: string) {
    if (!dragHandlersRef.current[shapeId]) {
      dragHandlersRef.current[shapeId] = throttle((x: number, y: number) => {
        const op = { opType: 'update' as const, shapeId, attrs: { x, y } }
        useShapeStore.getState().applyOp(op)
        sendOp(op)
      }, 50)
    }
    return dragHandlersRef.current[shapeId]!
  }

  function handleDragMove(shapeId: string, e: KonvaEventObject<MouseEvent>) {
    getDragHandler(shapeId)(e.target.x(), e.target.y())
  }

  // ── Transformer resize end ────────────────────────────────────────────────
  function handleTransformEnd(shapeId: string, e: KonvaEventObject<Event>) {
    const node = e.target
    const sx = node.scaleX()
    const sy = node.scaleY()
    // Normalize: reset scale and fold into shape dimensions
    node.scaleX(1)
    node.scaleY(1)

    const current = useShapeStore.getState().shapes[shapeId]
    if (!current) return

    let attrs: Record<string, unknown>
    if (current.shapeType === 'rect') {
      attrs = {
        x: node.x(), y: node.y(),
        w: Math.max(20, current.w * Math.abs(sx)),
        h: Math.max(20, current.h * Math.abs(sy)),
      }
    } else if (current.shapeType === 'circle') {
      attrs = {
        x: node.x(), y: node.y(),
        radius: Math.max(10, current.radius * Math.max(Math.abs(sx), Math.abs(sy))),
      }
    } else if (current.shapeType === 'text') {
      attrs = {
        x: node.x(), y: node.y(),
        fontSize: Math.max(8, Math.round(current.fontSize * Math.abs(sy))),
      }
    } else {
      return
    }

    const op = { opType: 'update' as const, shapeId, attrs }
    useShapeStore.getState().applyOp(op)
    sendOp(op)
  }

  // ── Inline text editing ───────────────────────────────────────────────────
  function handleTextDblClick(shapeId: string) {
    setSelected(shapeId)
    setEditingId(shapeId)
  }

  function finishTextEdit(text: string) {
    const id = editingId
    setEditingId(null)
    if (!id) return
    const current = useShapeStore.getState().shapes[id]
    if (!current || current.shapeType !== 'text') return
    const trimmed = text.trim() || (current as TextShape).text
    if (trimmed === (current as TextShape).text) return
    const op = { opType: 'update' as const, shapeId: id, attrs: { text: trimmed } }
    useShapeStore.getState().applyOp(op)
    sendOp(op)
  }

  // ── Stage background click → deselect ────────────────────────────────────
  function handleStageClick(e: KonvaEventObject<MouseEvent>) {
    if (e.target === e.target.getStage()) {
      setSelected(null)
      setEditingId(null)
    }
  }

  // ── Textarea geometry (fixed-position over the Konva text node) ───────────
  const editingShape = editingId ? shapes[editingId] : null
  const textShape = editingShape?.shapeType === 'text' ? (editingShape as TextShape) : null
  let textAreaStyle: React.CSSProperties | undefined
  if (textShape) {
    const stageBox = stageRef.current?.container().getBoundingClientRect()
    textAreaStyle = {
      position: 'fixed',
      top:  (stageBox?.top  ?? 0) + textShape.y,
      left: (stageBox?.left ?? 0) + textShape.x,
      fontSize:   textShape.fontSize,
      color:      textShape.fill,
      fontFamily: 'Inter, system-ui, sans-serif',
      border:     '1.5px solid #2563eb',
      borderRadius: 4,
      background:  'rgba(255,255,255,0.92)',
      padding:    '2px 4px',
      minWidth:   80,
      minHeight:  textShape.fontSize + 10,
      resize:     'none' as const,
      outline:    'none',
      zIndex:     500,
      lineHeight: 1.4,
    }
  }

  const shapeList = Object.values(shapes)

  return (
    <div ref={wrapRef} className="canvas-wrap">
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        onClick={handleStageClick}
      >
        <Layer>
          {shapeList.map(shape => {
            const sel = shape.shapeId === selectedId
            const base = {
              key:       shape.shapeId,
              id:        shape.shapeId,
              draggable: true,
              onDragMove:     (e: KonvaEventObject<MouseEvent>) => handleDragMove(shape.shapeId, e),
              onTransformEnd: (e: KonvaEventObject<Event>)      => handleTransformEnd(shape.shapeId, e),
              onClick:        () => setSelected(shape.shapeId),
              stroke:      sel ? '#2563eb' : undefined,
              strokeWidth: sel ? 2 : 0,
            }

            if (shape.shapeType === 'rect') {
              return (
                <Rect
                  {...base}
                  x={shape.x} y={shape.y}
                  width={shape.w} height={shape.h}
                  fill={shape.fill}
                  cornerRadius={4}
                />
              )
            }
            if (shape.shapeType === 'circle') {
              return (
                <Circle
                  {...base}
                  x={shape.x} y={shape.y}
                  radius={shape.radius}
                  fill={shape.fill}
                />
              )
            }
            if (shape.shapeType === 'text') {
              return (
                <Text
                  {...base}
                  x={shape.x} y={shape.y}
                  text={shape.text}
                  fill={shape.fill}
                  fontSize={shape.fontSize}
                  fontFamily="Inter, system-ui, sans-serif"
                  visible={editingId !== shape.shapeId}
                  onDblClick={() => handleTextDblClick(shape.shapeId)}
                />
              )
            }
            return null
          })}

          <Transformer
            ref={transformerRef}
            rotateEnabled={false}
            boundBoxFunc={(oldBox, newBox) => {
              if (Math.abs(newBox.width) < 20 || Math.abs(newBox.height) < 20) return oldBox
              return newBox
            }}
          />
        </Layer>
      </Stage>

      {textShape && textAreaStyle && (
        <textarea
          ref={textAreaRef}
          style={textAreaStyle}
          defaultValue={textShape.text}
          rows={1}
          onBlur={e => finishTextEdit(e.currentTarget.value)}
          onKeyDown={e => {
            if (e.key === 'Escape') { setEditingId(null); e.preventDefault() }
            if (e.key === 'Enter' && !e.shiftKey) { finishTextEdit(e.currentTarget.value); e.preventDefault() }
          }}
        />
      )}
    </div>
  )
}

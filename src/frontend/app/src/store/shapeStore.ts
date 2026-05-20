import { create } from 'zustand'
import type { Op } from '../protocol/messages'

export interface RectShape {
  shapeId: string; shapeType: 'rect'
  x: number; y: number; w: number; h: number; fill: string
}
export interface CircleShape {
  shapeId: string; shapeType: 'circle'
  x: number; y: number; radius: number; fill: string
}
export interface TextShape {
  shapeId: string; shapeType: 'text'
  x: number; y: number; text: string; fill: string; fontSize: number
}
export type Shape = RectShape | CircleShape | TextShape

interface ShapeState {
  shapes: Record<string, Shape>
  selectedId: string | null
  applyOp: (op: Op) => void
  setSelected: (id: string | null) => void
  reset: () => void
}

export const useShapeStore = create<ShapeState>((set) => ({
  shapes: {},
  selectedId: null,

  applyOp: (op) => set((s) => {
    if (op.opType === 'create') {
      if (!op.shapeType || !op.attrs) return s
      const shape = { shapeId: op.shapeId, shapeType: op.shapeType, ...op.attrs } as Shape
      return { shapes: { ...s.shapes, [op.shapeId]: shape } }
    }
    if (op.opType === 'update') {
      const existing = s.shapes[op.shapeId]
      if (!existing || !op.attrs) return s
      return { shapes: { ...s.shapes, [op.shapeId]: { ...existing, ...op.attrs } as Shape } }
    }
    if (op.opType === 'delete') {
      if (!s.shapes[op.shapeId]) return s
      const next = { ...s.shapes }
      delete next[op.shapeId]
      return { shapes: next, selectedId: s.selectedId === op.shapeId ? null : s.selectedId }
    }
    return s
  }),

  setSelected: (id) => set({ selectedId: id }),
  reset: () => set({ shapes: {}, selectedId: null }),
}))

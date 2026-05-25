import { create } from 'zustand';
import { compareHlc } from '../crdt/hlc';
import type { ShapeAttrs, ShapeOperation, ShapeType } from '../types/protocol';

export type CanvasShape = {
  id: string;
  type: ShapeType;
  attrs: Required<Pick<ShapeAttrs, 'x' | 'y' | 'fill' | 'stroke' | 'strokeWidth'>> & ShapeAttrs;
};

type VersionedValue = {
  value: ShapeAttrs[keyof ShapeAttrs];
  hlc: string;
  writerId: string;
};

type CrdtShape = {
  id: string;
  type: ShapeType;
  attrs: Partial<Record<keyof ShapeAttrs, VersionedValue>>;
  tombstone?: {
    hlc: string;
    writerId: string;
  };
};

type ShapeState = {
  crdtShapes: Record<string, CrdtShape>;
  shapes: Record<string, CanvasShape>;
  selectedId: string | null;
  applyOp: (op: ShapeOperation) => void;
  replaceWithSnapshot: (snapshot: Record<string, Record<string, unknown>>) => void;
  setSelectedId: (shapeId: string | null) => void;
};

const defaultsFor = (shapeType: ShapeType): CanvasShape['attrs'] => ({
  x: 120,
  y: 120,
  w: shapeType === 'rect' ? 140 : undefined,
  h: shapeType === 'rect' ? 90 : undefined,
  radius: shapeType === 'circle' ? 48 : undefined,
  text: shapeType === 'text' ? 'Text' : undefined,
  fill: shapeType === 'text' ? '#08060d' : '#3498db',
  stroke: '#123a32',
  strokeWidth: shapeType === 'text' ? 0 : 2,
});

const shouldApply = (nextHlc = '', nextWriter = '', current?: VersionedValue | CrdtShape['tombstone']) => {
  if (!current) {
    return true;
  }

  const comparison = compareHlc(nextHlc, current.hlc);
  if (comparison !== 0) {
    return comparison > 0;
  }

  return nextWriter.localeCompare(current.writerId) >= 0;
};

const toCanvasShape = (shape: CrdtShape): CanvasShape | null => {
  if (shape.tombstone) {
    return null;
  }

  const attrs = Object.fromEntries(
    Object.entries(shape.attrs).map(([key, versioned]) => [key, versioned?.value])
  ) as CanvasShape['attrs'];

  return { id: shape.id, type: shape.type, attrs };
};

const toCanvasShapes = (crdtShapes: Record<string, CrdtShape>) => Object.fromEntries(
  Object.values(crdtShapes)
    .map(toCanvasShape)
    .filter((shape): shape is CanvasShape => shape !== null)
    .map((shape) => [shape.id, shape])
);

export const useShapeStore = create<ShapeState>((set) => ({
  crdtShapes: {},
  shapes: {},
  selectedId: null,
  applyOp: (op) => set((state) => {
    const hlc = op.hlc ?? '';
    const writerId = op.writerId ?? '';
    const existing = state.crdtShapes[op.shapeId];

    if (op.opType === 'delete') {
      const nextCrdtShapes = { ...state.crdtShapes };
      if (!existing || shouldApply(hlc, writerId, existing.tombstone)) {
        nextCrdtShapes[op.shapeId] = {
          id: op.shapeId,
          type: existing?.type ?? op.shapeType,
          attrs: existing?.attrs ?? {},
          tombstone: { hlc, writerId },
        };
      }

      return {
        crdtShapes: nextCrdtShapes,
        shapes: toCanvasShapes(nextCrdtShapes),
        selectedId: state.selectedId === op.shapeId ? null : state.selectedId,
      };
    }

    if (op.opType === 'create') {
      const mergedAttrs = { ...defaultsFor(op.shapeType), ...op.attrs };
      const versionedAttrs = Object.fromEntries(
        Object.entries(mergedAttrs).map(([key, value]) => [key, { value, hlc, writerId }])
      ) as CrdtShape['attrs'];

      if (existing?.tombstone && !shouldApply(hlc, writerId, existing.tombstone)) {
        return state;
      }

      const nextCrdtShapes = {
        ...state.crdtShapes,
        [op.shapeId]: {
          id: op.shapeId,
          type: op.shapeType,
          attrs: {
            ...existing?.attrs,
            ...versionedAttrs,
          },
        },
      };

      return {
        crdtShapes: nextCrdtShapes,
        shapes: toCanvasShapes(nextCrdtShapes),
      };
    }

    if (!existing) {
      return state;
    }

    if (existing.tombstone && !shouldApply(hlc, writerId, existing.tombstone)) {
      return state;
    }

    const nextAttrs = { ...existing.attrs };
    Object.entries(op.attrs ?? {}).forEach(([key, value]) => {
      const typedKey = key as keyof ShapeAttrs;
      if (shouldApply(hlc, writerId, nextAttrs[typedKey])) {
        nextAttrs[typedKey] = { value, hlc, writerId };
      }
    });

    const nextCrdtShapes = {
      ...state.crdtShapes,
      [op.shapeId]: {
        ...existing,
        attrs: nextAttrs,
      },
    };

    return {
      crdtShapes: nextCrdtShapes,
      shapes: toCanvasShapes(nextCrdtShapes),
    };
  }),
  replaceWithSnapshot: (snapshot) => {
    const crdtShapes = Object.fromEntries(
      Object.entries(snapshot).map(([shapeId, attrs]) => {
        const shapeType = (attrs.shapeType as ShapeType | undefined) ?? 'rect';
        const mergedAttrs = { ...defaultsFor(shapeType), ...attrs };
        delete (mergedAttrs as Record<string, unknown>).shapeType;

        return [
          shapeId,
          {
            id: shapeId,
            type: shapeType,
            attrs: Object.fromEntries(
              Object.entries(mergedAttrs).map(([key, value]) => [
                key,
                { value: value as ShapeAttrs[keyof ShapeAttrs], hlc: 'snapshot', writerId: 'history' },
              ])
            ) as CrdtShape['attrs'],
          },
        ];
      })
    ) as Record<string, CrdtShape>;

    return {
      crdtShapes,
      shapes: toCanvasShapes(crdtShapes),
      selectedId: null,
    };
  },
  setSelectedId: (selectedId) => set({ selectedId }),
}));

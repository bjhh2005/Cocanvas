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

type SnapshotAttrValue = ShapeAttrs[keyof ShapeAttrs] | {
  value: ShapeAttrs[keyof ShapeAttrs];
  hlc?: string;
  writerId?: string;
};

type ShapeState = {
  crdtShapes: Record<string, CrdtShape>;
  shapes: Record<string, CanvasShape>;
  selectedId: string | null;
  selectedIds: string[];
  applyOp: (op: ShapeOperation) => void;
  replaceWithSnapshot: (snapshot: Record<string, Record<string, SnapshotAttrValue>>) => void;
  setSelectedId: (shapeId: string | null) => void;
  setSelectedIds: (shapeIds: string[]) => void;
  toggleSelectedId: (shapeId: string) => void;
};

const shapeSizeDefaults = (shapeType: ShapeType) => {
  if (shapeType === 'sticky') {
    return { w: 190, h: 170 };
  }

  if (shapeType === 'diamond' || shapeType === 'triangle') {
    return { w: 132, h: 104 };
  }

  if (shapeType === 'rect' || shapeType === 'roundedRect') {
    return { w: 140, h: 90 };
  }

  if (shapeType === 'comment') {
    return { w: 220, h: 86 };
  }

  if (shapeType === 'card') {
    return { w: 260, h: 168 };
  }

  if (shapeType === 'frame') {
    return { w: 520, h: 320 };
  }

  return {};
};

const defaultsFor = (shapeType: ShapeType): CanvasShape['attrs'] => ({
  x: 120,
  y: 120,
  ...shapeSizeDefaults(shapeType),
  radius: shapeType === 'circle' ? 48 : undefined,
  text: shapeType === 'text'
    ? 'Text'
    : shapeType === 'sticky'
      ? 'Add idea'
      : shapeType === 'comment'
        ? 'Comment'
        : shapeType === 'frame'
          ? 'Frame'
          : undefined,
  title: shapeType === 'card' ? 'New idea' : undefined,
  body: shapeType === 'card' ? 'Describe the signal, decision, or next step.' : undefined,
  tags: shapeType === 'card' ? ['Insight'] : undefined,
  priority: shapeType === 'card' ? 'medium' : undefined,
  status: shapeType === 'card' ? 'idea' : undefined,
  assignee: shapeType === 'card' ? '' : undefined,
  votes: shapeType === 'card' ? 0 : undefined,
  voters: shapeType === 'card' ? [] : undefined,
  fill: shapeType === 'text' || shapeType === 'connector' || shapeType === 'pen'
    ? 'transparent'
    : shapeType === 'sticky'
      ? '#ffd966'
      : shapeType === 'comment'
        ? '#ffffff'
        : shapeType === 'frame'
          ? 'rgba(255,255,255,0.02)'
          : shapeType === 'card'
            ? '#dcfce7'
            : '#3498db',
  textColor: shapeType === 'text' ? '#08060d' : '#202124',
  fontSize: shapeType === 'sticky' ? 22 : 26,
  fontStyle: shapeType === 'text' ? 'bold' : 'normal',
  cornerRadius: shapeType === 'sticky' ? 10 : shapeType === 'roundedRect' ? 18 : shapeType === 'comment' || shapeType === 'card' ? 8 : 0,
  stroke: shapeType === 'text' || shapeType === 'sticky' ? 'transparent' : shapeType === 'pen' ? '#111827' : '#123a32',
  strokeWidth: shapeType === 'text' ? 0 : shapeType === 'pen' ? 3 : 2,
  zIndex: shapeType === 'frame' ? -10 : 0,
  fromAnchor: shapeType === 'connector' ? 'right' : undefined,
  toAnchor: shapeType === 'connector' ? 'left' : undefined,
  arrowEnd: shapeType === 'connector' ? true : undefined,
  points: shapeType === 'pen' ? [] : undefined,
  resolved: shapeType === 'comment' ? false : undefined,
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
  selectedIds: [],
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
        selectedIds: state.selectedIds.filter((shapeId) => shapeId !== op.shapeId),
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
              Object.entries(mergedAttrs).map(([key, raw]) => {
                const versioned = raw && typeof raw === 'object' && !Array.isArray(raw) && 'value' in raw
                  ? raw as { value: ShapeAttrs[keyof ShapeAttrs]; hlc?: string; writerId?: string }
                  : null;

                return [
                  key,
                  {
                    value: versioned ? versioned.value : raw as ShapeAttrs[keyof ShapeAttrs],
                    hlc: versioned?.hlc ?? '',
                    writerId: versioned?.writerId ?? 'history',
                  },
                ];
              })
            ) as CrdtShape['attrs'],
          },
        ];
      })
    ) as Record<string, CrdtShape>;

    return {
      crdtShapes,
      shapes: toCanvasShapes(crdtShapes),
      selectedId: null,
      selectedIds: [],
    };
  },
  setSelectedId: (selectedId) => set({ selectedId, selectedIds: selectedId ? [selectedId] : [] }),
  setSelectedIds: (selectedIds) => set({ selectedIds, selectedId: selectedIds[0] ?? null }),
  toggleSelectedId: (shapeId) => set((state) => {
    const selectedIds = state.selectedIds.includes(shapeId)
      ? state.selectedIds.filter((selectedId) => selectedId !== shapeId)
      : [...state.selectedIds, shapeId];
    return { selectedIds, selectedId: selectedIds[0] ?? null };
  }),
}));

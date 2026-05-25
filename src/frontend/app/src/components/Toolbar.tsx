import type { ShapeOperation, ShapeType } from '../types/protocol';

type ToolbarProps = {
  selectedId: string | null;
  onCreateShape: (shapeType: ShapeType) => void;
  onDeleteSelected: () => void;
};

export function Toolbar({ selectedId, onCreateShape, onDeleteSelected }: ToolbarProps) {
  return (
    <div className="toolbar" aria-label="Canvas toolbar">
      <button type="button" onClick={() => onCreateShape('rect')}>Rect</button>
      <button type="button" onClick={() => onCreateShape('circle')}>Circle</button>
      <button type="button" onClick={() => onCreateShape('text')}>Text</button>
      <button type="button" onClick={onDeleteSelected} disabled={!selectedId}>Delete</button>
    </div>
  );
}

export const createShapeOp = (shapeType: ShapeType, x: number, y: number): ShapeOperation => {
  const shapeId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `shape-${Date.now()}-${Math.random().toString(16).slice(2)}`;

  if (shapeType === 'circle') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: { x, y, radius: 48, fill: '#f59f00', stroke: '#5f3700', strokeWidth: 2 },
    };
  }

  if (shapeType === 'text') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: { x, y, text: 'Cocanvas', fill: '#08060d', stroke: 'transparent', strokeWidth: 0 },
    };
  }

  return {
    opType: 'create',
    shapeId,
    shapeType,
    attrs: { x, y, w: 140, h: 90, fill: '#3498db', stroke: '#123a32', strokeWidth: 2 },
  };
};

import type { ShapeOperation, ShapeType } from '../types/protocol';

export type ToolMode =
  | 'select'
  | 'hand'
  | 'sticky'
  | 'text'
  | 'rect'
  | 'roundedRect'
  | 'circle'
  | 'diamond'
  | 'triangle'
  | 'connector'
  | 'pen'
  | 'comment'
  | 'frame';

type ToolbarProps = {
  activeTool: ToolMode;
  selectedId: string | null;
  onSelectTool: (tool: ToolMode) => void;
  onDeleteSelected: () => void;
};

const tools: Array<{ mode: ToolMode; label: string; icon: string; title: string }> = [
  { mode: 'select', label: 'Select', icon: 'V', title: 'Select' },
  { mode: 'hand', label: 'Hand', icon: 'H', title: 'Pan canvas' },
  { mode: 'sticky', label: 'Sticky', icon: 'N', title: 'Sticky note' },
  { mode: 'text', label: 'Text', icon: 'T', title: 'Text' },
  { mode: 'rect', label: 'Rect', icon: 'R', title: 'Rectangle' },
  { mode: 'roundedRect', label: 'Round', icon: 'U', title: 'Rounded rectangle' },
  { mode: 'circle', label: 'Circle', icon: 'O', title: 'Circle' },
  { mode: 'diamond', label: 'Diamond', icon: 'D', title: 'Diamond' },
  { mode: 'triangle', label: 'Tri', icon: 'Tri', title: 'Triangle' },
  { mode: 'connector', label: 'Line', icon: '->', title: 'Connector' },
  { mode: 'pen', label: 'Pen', icon: 'P', title: 'Pen' },
  { mode: 'comment', label: 'Note', icon: 'C', title: 'Comment' },
  { mode: 'frame', label: 'Frame', icon: 'F', title: 'Frame' },
];

export function Toolbar({ activeTool, selectedId, onSelectTool, onDeleteSelected }: ToolbarProps) {
  return (
    <aside className="left-toolbar" aria-label="Canvas toolbar">
      {tools.map((tool) => (
        <button
          key={tool.mode}
          type="button"
          title={tool.title}
          className={activeTool === tool.mode ? 'active' : undefined}
          onClick={() => onSelectTool(tool.mode)}
        >
          <span>{tool.icon}</span>
          <small>{tool.label}</small>
        </button>
      ))}
      <div className="toolbar-divider" />
      <button type="button" title="Delete" onClick={onDeleteSelected} disabled={!selectedId}>
        <span>Del</span>
        <small>Delete</small>
      </button>
    </aside>
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
      attrs: { x, y, radius: 48, fill: '#f59f00', stroke: '#5f3700', strokeWidth: 2, zIndex: Date.now() },
    };
  }

  if (shapeType === 'text') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        text: 'Cocanvas',
        fill: 'transparent',
        textColor: '#08060d',
        fontSize: 28,
        fontStyle: 'bold',
        stroke: 'transparent',
        strokeWidth: 0,
        zIndex: Date.now(),
      },
    };
  }

  if (shapeType === 'sticky') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        w: 190,
        h: 170,
        text: 'Add idea',
        fill: '#ffd966',
        textColor: '#202124',
        fontSize: 22,
        stroke: 'transparent',
        strokeWidth: 0,
        cornerRadius: 10,
        zIndex: Date.now(),
      },
    };
  }

  if (shapeType === 'diamond' || shapeType === 'triangle') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: { x, y, w: 132, h: 104, fill: '#9fc5e8', stroke: '#1f4e79', strokeWidth: 2, zIndex: Date.now() },
    };
  }

  if (shapeType === 'comment') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        w: 220,
        h: 86,
        text: 'Comment',
        fill: '#ffffff',
        textColor: '#111827',
        fontSize: 16,
        stroke: '#f59e0b',
        strokeWidth: 2,
        cornerRadius: 8,
        resolved: false,
        zIndex: Date.now(),
      },
    };
  }

  if (shapeType === 'frame') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        w: 520,
        h: 320,
        text: 'Frame',
        fill: 'rgba(255,255,255,0.02)',
        textColor: '#475569',
        fontSize: 20,
        stroke: '#64748b',
        strokeWidth: 2,
        zIndex: -10,
      },
    };
  }

  return {
    opType: 'create',
    shapeId,
    shapeType,
    attrs: {
      x,
      y,
      w: 140,
      h: 90,
      fill: shapeType === 'roundedRect' ? '#b7e1cd' : '#3498db',
      stroke: shapeType === 'roundedRect' ? '#145c4a' : '#123a32',
      strokeWidth: 2,
      cornerRadius: shapeType === 'roundedRect' ? 18 : 0,
      zIndex: Date.now(),
    },
  };
};

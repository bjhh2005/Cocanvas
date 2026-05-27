import type { ShapeOperation, ShapeType } from '../types/protocol';

export type ToolMode = 'select' | 'hand' | 'sticky' | 'text' | 'rect' | 'circle';

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
  { mode: 'circle', label: 'Circle', icon: 'O', title: 'Circle' },
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
      attrs: { x, y, radius: 48, fill: '#f59f00', stroke: '#5f3700', strokeWidth: 2 },
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
      },
    };
  }

  return {
    opType: 'create',
    shapeId,
    shapeType,
    attrs: { x, y, w: 140, h: 90, fill: '#3498db', stroke: '#123a32', strokeWidth: 2 },
  };
};

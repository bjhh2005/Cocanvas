import { useState } from 'react';
import {
  ArrowRight,
  Circle,
  CreditCard,
  Diamond,
  Frame,
  Hand,
  MessageSquare,
  MousePointer2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Square,
  StickyNote,
  Trash2,
  Triangle,
  Type,
  type LucideIcon,
} from 'lucide-react';

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
  | 'frame'
  | 'card';

type ToolbarProps = {
  activeTool: ToolMode;
  selectedId: string | null;
  onSelectTool: (tool: ToolMode) => void;
  onDeleteSelected: () => void;
};

const createTools = new Set<ToolMode>([
  'sticky',
  'card',
  'text',
  'rect',
  'roundedRect',
  'circle',
  'diamond',
  'triangle',
  'pen',
  'comment',
  'frame',
]);

const tools: Array<{ mode: ToolMode; label: string; Icon: LucideIcon; title: string; iconClass?: string }> = [
  { mode: 'select', label: 'Select', Icon: MousePointer2, title: 'Select' },
  { mode: 'hand', label: 'Hand', Icon: Hand, title: 'Pan canvas' },
  { mode: 'sticky', label: 'Sticky', Icon: StickyNote, title: 'Sticky note' },
  { mode: 'card', label: 'Card', Icon: CreditCard, title: 'Product card' },
  { mode: 'text', label: 'Text', Icon: Type, title: 'Text' },
  { mode: 'rect', label: 'Rect', Icon: Square, title: 'Rectangle' },
  { mode: 'roundedRect', label: 'Round', Icon: Square, title: 'Rounded rectangle', iconClass: 'rounded-rect-icon' },
  { mode: 'circle', label: 'Circle', Icon: Circle, title: 'Circle' },
  { mode: 'diamond', label: 'Diamond', Icon: Diamond, title: 'Diamond' },
  { mode: 'triangle', label: 'Tri', Icon: Triangle, title: 'Triangle' },
  { mode: 'connector', label: 'Line', Icon: ArrowRight, title: 'Connector' },
  { mode: 'pen', label: 'Pen', Icon: Pencil, title: 'Pen' },
  { mode: 'comment', label: 'Note', Icon: MessageSquare, title: 'Comment' },
  { mode: 'frame', label: 'Frame', Icon: Frame, title: 'Frame' },
];

export function Toolbar({ activeTool, selectedId, onSelectTool, onDeleteSelected }: ToolbarProps) {
  const [collapsed, setCollapsed] = useState(false);
  const activeToolConfig = tools.find((tool) => tool.mode === activeTool) ?? tools[0];

  return (
    <aside className={collapsed ? 'left-toolbar collapsed' : 'left-toolbar'} aria-label="Canvas toolbar">
      <button
        type="button"
        title={collapsed ? 'Expand toolbar' : 'Collapse toolbar'}
        className="toolbar-collapse-button"
        onClick={() => setCollapsed((current) => !current)}
      >
        {collapsed ? <PanelLeftOpen size={18} aria-hidden /> : <PanelLeftClose size={18} aria-hidden />}
        <small>{collapsed ? 'More' : 'Less'}</small>
      </button>

      {collapsed ? (
        <button
          type="button"
          title={activeToolConfig.title}
          className="active"
          onClick={() => setCollapsed(false)}
        >
          <activeToolConfig.Icon size={18} className={activeToolConfig.iconClass} aria-hidden />
          <small>{activeToolConfig.label}</small>
        </button>
      ) : (
        <div className="toolbar-scroll">
          {tools.map(({ Icon, ...tool }) => (
            <button
              key={tool.mode}
              type="button"
              title={tool.title}
              draggable={createTools.has(tool.mode)}
              className={activeTool === tool.mode ? 'active' : undefined}
              onClick={() => onSelectTool(tool.mode)}
              onDragStart={(event) => {
                if (!createTools.has(tool.mode)) {
                  return;
                }

                event.dataTransfer.setData('application/x-cocanvas-tool', tool.mode);
                event.dataTransfer.effectAllowed = 'copy';
              }}
            >
              <Icon size={18} className={tool.iconClass} aria-hidden />
              <small>{tool.label}</small>
            </button>
          ))}
          <div className="toolbar-divider" />
          <button type="button" title="Delete" onClick={onDeleteSelected} disabled={!selectedId}>
            <Trash2 size={18} aria-hidden />
            <small>Delete</small>
          </button>
        </div>
      )}
    </aside>
  );
}

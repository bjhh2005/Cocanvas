import { useState } from 'react';
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

const tools: Array<{ mode: ToolMode; label: string; icon: string; title: string }> = [
  { mode: 'select', label: 'Select', icon: 'V', title: 'Select' },
  { mode: 'hand', label: 'Hand', icon: 'H', title: 'Pan canvas' },
  { mode: 'sticky', label: 'Sticky', icon: 'N', title: 'Sticky note' },
  { mode: 'card', label: 'Card', icon: 'K', title: 'Product card' },
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
        <span>{collapsed ? '+' : '-'}</span>
        <small>{collapsed ? 'More' : 'Less'}</small>
      </button>

      {collapsed ? (
        <button
          type="button"
          title={activeToolConfig.title}
          className="active"
          onClick={() => setCollapsed(false)}
        >
          <span>{activeToolConfig.icon}</span>
          <small>{activeToolConfig.label}</small>
        </button>
      ) : (
        <div className="toolbar-scroll">
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
        </div>
      )}
    </aside>
  );
}

import { useMemo, useState } from 'react';
import type { CanvasShape } from '../store/shapeStore';
import type { ShapeAttrs } from '../types/protocol';
import {
  cardPriorities,
  cardStatuses,
  priorityLabels,
  productTemplates,
  shapeText,
  statusLabels,
  tagOptions,
  type ProductTemplateId,
} from '../whiteboard/productBoard';

type ProductPanelProps = {
  shapes: CanvasShape[];
  selectedShape: CanvasShape | null;
  query: string;
  statusFilter: string;
  tagFilter: string;
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (status: string) => void;
  onTagFilterChange: (tag: string) => void;
  onCreateCard: () => void;
  onTemplateInsert: (templateId: ProductTemplateId) => void;
  onUpdateSelected: (attrs: ShapeAttrs) => void;
  onVoteSelected: () => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
};

const tagsToInput = (tags?: string[]) => tags?.join(', ') ?? '';
const inputToTags = (value: string) => value
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean);

export function ProductPanel({
  shapes,
  selectedShape,
  query,
  statusFilter,
  tagFilter,
  onQueryChange,
  onStatusFilterChange,
  onTagFilterChange,
  onCreateCard,
  onTemplateInsert,
  onUpdateSelected,
  onVoteSelected,
  onExportMarkdown,
  onExportJson,
}: ProductPanelProps) {
  const [collapsed, setCollapsed] = useState(false);
  const cards = useMemo(() => shapes.filter((shape) => shape.type === 'card'), [shapes]);
  const visibleCards = useMemo(() => cards.filter((shape) => {
    const matchesQuery = query.trim() === '' || shapeText(shape).includes(query.trim().toLowerCase());
    const matchesStatus = statusFilter === 'all' || shape.attrs.status === statusFilter;
    const matchesTag = tagFilter === 'all' || (shape.attrs.tags ?? []).includes(tagFilter);
    return matchesQuery && matchesStatus && matchesTag;
  }), [cards, query, statusFilter, tagFilter]);
  const topCards = [...cards]
    .sort((a, b) => (b.attrs.votes ?? 0) - (a.attrs.votes ?? 0))
    .slice(0, 4);

  if (collapsed) {
    return (
      <aside className="product-panel collapsed" aria-label="Product board">
        <button type="button" title="Open product panel" onClick={() => setCollapsed(false)}>Plan</button>
      </aside>
    );
  }

  return (
    <aside className="product-panel" aria-label="Product board">
      <div className="product-panel-header">
        <strong>Board flow</strong>
        <button type="button" title="Collapse product panel" onClick={() => setCollapsed(true)}>Close</button>
      </div>

      <div className="product-actions">
        <button type="button" onClick={onCreateCard}>New card</button>
        <button type="button" onClick={onExportMarkdown}>Markdown</button>
        <button type="button" onClick={onExportJson}>JSON</button>
      </div>

      <label className="product-field">
        <span>Search</span>
        <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="tag, owner, title" />
      </label>

      <div className="product-filter-row">
        <label>
          <span>Status</span>
          <select value={statusFilter} onChange={(event) => onStatusFilterChange(event.target.value)}>
            <option value="all">All</option>
            {cardStatuses.map((status) => (
              <option key={status} value={status}>{statusLabels[status]}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Tag</span>
          <select value={tagFilter} onChange={(event) => onTagFilterChange(event.target.value)}>
            <option value="all">All</option>
            {tagOptions.map((tag) => (
              <option key={tag} value={tag}>{tag}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="template-grid">
        {productTemplates.map((template) => (
          <button key={template.id} type="button" onClick={() => onTemplateInsert(template.id)}>
            {template.label}
          </button>
        ))}
      </div>

      <section className="product-summary">
        <div><strong>{cards.length}</strong><span>cards</span></div>
        <div><strong>{cards.reduce((sum, shape) => sum + (shape.attrs.votes ?? 0), 0)}</strong><span>votes</span></div>
        <div><strong>{visibleCards.length}</strong><span>shown</span></div>
      </section>

      {selectedShape?.type === 'card' && (
        <section className="card-editor" aria-label="Selected card">
          <label>
            <span>Title</span>
            <input
              value={selectedShape.attrs.title ?? ''}
              onChange={(event) => onUpdateSelected({ title: event.target.value })}
            />
          </label>
          <label>
            <span>Body</span>
            <textarea
              value={selectedShape.attrs.body ?? ''}
              onChange={(event) => onUpdateSelected({ body: event.target.value })}
            />
          </label>
          <div className="product-filter-row">
            <label>
              <span>Status</span>
              <select
                value={selectedShape.attrs.status ?? 'idea'}
                onChange={(event) => onUpdateSelected({ status: event.target.value as NonNullable<ShapeAttrs['status']> })}
              >
                {cardStatuses.map((status) => (
                  <option key={status} value={status}>{statusLabels[status]}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Priority</span>
              <select
                value={selectedShape.attrs.priority ?? 'medium'}
                onChange={(event) => onUpdateSelected({ priority: event.target.value as NonNullable<ShapeAttrs['priority']> })}
              >
                {cardPriorities.map((priority) => (
                  <option key={priority} value={priority}>{priorityLabels[priority]}</option>
                ))}
              </select>
            </label>
          </div>
          <label>
            <span>Assignee</span>
            <input
              value={selectedShape.attrs.assignee ?? ''}
              onChange={(event) => onUpdateSelected({ assignee: event.target.value })}
            />
          </label>
          <label>
            <span>Tags</span>
            <input
              value={tagsToInput(selectedShape.attrs.tags)}
              onChange={(event) => onUpdateSelected({ tags: inputToTags(event.target.value) })}
            />
          </label>
          <button type="button" onClick={onVoteSelected}>
            Vote {selectedShape.attrs.votes ?? 0}
          </button>
        </section>
      )}

      <section className="top-votes" aria-label="Top voted cards">
        <strong>Top votes</strong>
        {topCards.length === 0 ? (
          <p>No cards yet</p>
        ) : topCards.map((shape) => (
          <div key={shape.id}>
            <span>{shape.attrs.title ?? 'Untitled'}</span>
            <strong>{shape.attrs.votes ?? 0}</strong>
          </div>
        ))}
      </section>
    </aside>
  );
}

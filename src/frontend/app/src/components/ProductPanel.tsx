import { useMemo, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpToLine,
  BadgePlus,
  BarChart3,
  CircleDot,
  ClipboardCheck,
  Columns3,
  Copy,
  FileInput,
  FileJson,
  FileText,
  Flame,
  GitBranch,
  Goal,
  LayoutGrid,
  ListTodo,
  Map,
  MessageSquareQuote,
  PanelRightClose,
  PanelRightOpen,
  PaintBucket,
  Rocket,
  Search,
  Sparkles,
  SquareDashedMousePointer,
  ThumbsUp,
  Trash2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react';
import type { CanvasShape } from '../store/shapeStore';
import type { ShapeAttrs } from '../types/protocol';
import {
  cardPriorities,
  cardStatuses,
  meetingPhases,
  priorityLabels,
  productTemplates,
  shapeText,
  statusLabels,
  tagOptions,
  type MeetingPhase,
  type MeetingPhaseId,
  type ProductTemplateId,
} from '../whiteboard/productBoard';

type ProductPanelProps = {
  shapes: CanvasShape[];
  selectedShape: CanvasShape | null;
  selectedCount: number;
  query: string;
  statusFilter: string;
  tagFilter: string;
  activePhaseId: MeetingPhaseId;
  phases: MeetingPhase[];
  onQueryChange: (query: string) => void;
  onStatusFilterChange: (status: string) => void;
  onTagFilterChange: (tag: string) => void;
  onPhaseChange: (phaseId: MeetingPhaseId) => void;
  onPhaseStep: (direction: 1 | -1) => void;
  onInsertPhaseTemplate: () => void;
  onAddPhase: () => void;
  onRemovePhase: (phaseId: MeetingPhaseId) => void;
  onUpdatePhase: (phaseId: MeetingPhaseId, patch: Partial<MeetingPhase>) => void;
  onImportFile: (file: File) => void;
  onCreateCard: () => void;
  onTemplateInsert: (templateId: ProductTemplateId) => void;
  onUpdateSelected: (attrs: ShapeAttrs) => void;
  onVoteSelected: () => void;
  onDeleteSelected: () => void;
  onLayerChange: (direction: 'front' | 'back') => void;
  onExportMarkdown: () => void;
  onExportJson: () => void;
};

const tagsToInput = (tags?: string[]) => tags?.join(', ') ?? '';
const inputToTags = (value: string) => value
  .split(',')
  .map((tag) => tag.trim())
  .filter(Boolean);

const templateIcons: Record<ProductTemplateId, LucideIcon> = {
  swot: LayoutGrid,
  journey: Map,
  matrix: Columns3,
  'problem-solution': GitBranch,
  kanban: ListTodo,
  retro: Sparkles,
  'prd-review': ClipboardCheck,
  'user-interview': MessageSquareQuote,
  'decision-matrix': Goal,
  'ice-prioritization': BarChart3,
  'rice-scoring': BarChart3,
  'risk-map': TriangleAlert,
  'incident-review': Flame,
  'gtm-plan': Rocket,
  'experiment-plan': Sparkles,
};

const fillColors = ['#ffd966', '#dcfce7', '#e0f2fe', '#fef3c7', '#ffe4e6', '#ede9fe', '#ffffff', 'transparent'];
const strokeColors = ['#111827', '#334155', '#1d4ed8', '#047857', '#b45309', '#be123c', '#6d28d9', 'transparent'];
const textEditableTypes = new Set(['text', 'sticky', 'comment', 'frame', 'rect', 'roundedRect', 'circle', 'diamond', 'triangle']);

const numberOrUndefined = (value: string) => {
  if (value.trim() === '') {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const selectedLabel = (shape: CanvasShape | null, selectedCount: number) => {
  if (selectedCount > 1) {
    return `${selectedCount} items`;
  }

  if (!shape) {
    return 'Nothing selected';
  }

  if (shape.type === 'card') {
    return shape.attrs.title || 'Card';
  }

  return shape.attrs.text || shape.type;
};

export function ProductPanel({
  shapes,
  selectedShape,
  selectedCount,
  query,
  statusFilter,
  tagFilter,
  activePhaseId,
  phases,
  onQueryChange,
  onStatusFilterChange,
  onTagFilterChange,
  onPhaseChange,
  onPhaseStep,
  onInsertPhaseTemplate,
  onAddPhase,
  onRemovePhase,
  onUpdatePhase,
  onImportFile,
  onCreateCard,
  onTemplateInsert,
  onUpdateSelected,
  onVoteSelected,
  onDeleteSelected,
  onLayerChange,
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
  const canEditText = selectedShape ? textEditableTypes.has(selectedShape.type) : false;
  const showSizeControls = selectedShape && selectedShape.type !== 'connector' && selectedShape.type !== 'pen';
  const showPaintControls = selectedShape && selectedShape.type !== 'text';
  const activePhaseIndex = phases.findIndex((phase) => phase.id === activePhaseId);
  const activePhase = phases[activePhaseIndex] ?? phases[0] ?? meetingPhases[0];
  const templateCategories = [...new Set(productTemplates.map((template) => template.category))];

  if (collapsed) {
    return (
      <aside className="product-panel collapsed" aria-label="Product board">
        <button type="button" title="Open inspector" onClick={() => setCollapsed(false)}>
          <PanelRightOpen size={18} aria-hidden />
          <span>Inspect</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="product-panel" aria-label="Board inspector">
      <div className="product-panel-header">
        <strong>Inspector</strong>
        <button type="button" title="Collapse inspector" onClick={() => setCollapsed(true)}>
          <PanelRightClose size={16} aria-hidden />
          <span>Close</span>
        </button>
      </div>

      <section className="inspector-section selected-inspector" aria-label="Selected item">
        <div className="section-title">
          <SquareDashedMousePointer size={16} aria-hidden />
          <strong>{selectedLabel(selectedShape, selectedCount)}</strong>
        </div>

        {!selectedShape && selectedCount <= 1 && (
          <div className="empty-inspector">
            <button type="button" onClick={onCreateCard}>
              <BadgePlus size={16} aria-hidden />
              <span>New card</span>
            </button>
          </div>
        )}

        {selectedCount > 1 && (
          <div className="inspector-actions">
            <button type="button" title="Bring to front" onClick={() => onLayerChange('front')}>
              <ArrowUpToLine size={16} aria-hidden />
              <span>Front</span>
            </button>
            <button type="button" title="Send to back" onClick={() => onLayerChange('back')}>
              <ArrowDownToLine size={16} aria-hidden />
              <span>Back</span>
            </button>
            <button type="button" title="Delete selection" onClick={onDeleteSelected}>
              <Trash2 size={16} aria-hidden />
              <span>Delete</span>
            </button>
          </div>
        )}

        {selectedShape?.type === 'card' && (
          <div className="inspector-fields">
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
              <ThumbsUp size={16} aria-hidden />
              <span>Vote {selectedShape.attrs.votes ?? 0}</span>
            </button>
          </div>
        )}

        {selectedShape && selectedShape.type !== 'card' && (
          <div className="inspector-fields">
            {canEditText && (
              <label>
                <span>Text</span>
                <textarea
                  value={selectedShape.attrs.text ?? ''}
                  onChange={(event) => onUpdateSelected({ text: event.target.value })}
                />
              </label>
            )}

            {selectedShape.type === 'comment' && (
              <label className="toggle-row">
                <input
                  type="checkbox"
                  checked={selectedShape.attrs.resolved === true}
                  onChange={(event) => onUpdateSelected({ resolved: event.target.checked })}
                />
                <span>Resolved</span>
              </label>
            )}

            {showSizeControls && (
              <div className="number-grid">
                <label>
                  <span>X</span>
                  <input
                    type="number"
                    value={Math.round(selectedShape.attrs.x)}
                    onChange={(event) => onUpdateSelected({ x: numberOrUndefined(event.target.value) })}
                  />
                </label>
                <label>
                  <span>Y</span>
                  <input
                    type="number"
                    value={Math.round(selectedShape.attrs.y)}
                    onChange={(event) => onUpdateSelected({ y: numberOrUndefined(event.target.value) })}
                  />
                </label>
                {selectedShape.type === 'circle' ? (
                  <label>
                    <span>Radius</span>
                    <input
                      type="number"
                      value={selectedShape.attrs.radius ?? 48}
                      onChange={(event) => onUpdateSelected({ radius: numberOrUndefined(event.target.value) })}
                    />
                  </label>
                ) : (
                  <>
                    <label>
                      <span>Width</span>
                      <input
                        type="number"
                        value={selectedShape.attrs.w ?? ''}
                        onChange={(event) => onUpdateSelected({ w: numberOrUndefined(event.target.value) })}
                      />
                    </label>
                    <label>
                      <span>Height</span>
                      <input
                        type="number"
                        value={selectedShape.attrs.h ?? ''}
                        onChange={(event) => onUpdateSelected({ h: numberOrUndefined(event.target.value) })}
                      />
                    </label>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {selectedShape && (
          <div className="inspector-fields compact-fields">
            {showPaintControls && (
              <>
                <div className="field-label">
                  <PaintBucket size={14} aria-hidden />
                  <span>Fill</span>
                </div>
                <div className="swatches panel-swatches" aria-label="Fill color">
                  {fillColors.map((fill) => (
                    <button
                      key={fill}
                      type="button"
                      title={`Fill ${fill}`}
                      className={fill === 'transparent' ? 'transparent-swatch' : undefined}
                      style={{ background: fill === 'transparent' ? '#ffffff' : fill }}
                      onClick={() => onUpdateSelected({ fill })}
                    />
                  ))}
                </div>
              </>
            )}

            <div className="field-label">
              <CircleDot size={14} aria-hidden />
              <span>Stroke</span>
            </div>
            <div className="swatches panel-swatches" aria-label="Stroke color">
              {strokeColors.map((stroke) => (
                <button
                  key={stroke}
                  type="button"
                  title={`Stroke ${stroke}`}
                  className={stroke === 'transparent' ? 'transparent-swatch' : undefined}
                  style={{ background: stroke === 'transparent' ? '#ffffff' : stroke }}
                  onClick={() => onUpdateSelected({ stroke })}
                />
              ))}
            </div>

            <div className="number-grid">
              <label>
                <span>Stroke</span>
                <input
                  type="number"
                  min={0}
                  max={12}
                  value={selectedShape.attrs.strokeWidth ?? 0}
                  onChange={(event) => onUpdateSelected({ strokeWidth: numberOrUndefined(event.target.value) })}
                />
              </label>
              <label>
                <span>Font</span>
                <input
                  type="number"
                  min={10}
                  max={72}
                  value={selectedShape.attrs.fontSize ?? 18}
                  onChange={(event) => onUpdateSelected({ fontSize: numberOrUndefined(event.target.value) })}
                />
              </label>
            </div>

            <div className="inspector-actions">
              <button type="button" title="Bring to front" onClick={() => onLayerChange('front')}>
                <ArrowUpToLine size={16} aria-hidden />
                <span>Front</span>
              </button>
              <button type="button" title="Send to back" onClick={() => onLayerChange('back')}>
                <ArrowDownToLine size={16} aria-hidden />
                <span>Back</span>
              </button>
              <button type="button" title="Delete selection" onClick={onDeleteSelected}>
                <Trash2 size={16} aria-hidden />
                <span>Delete</span>
              </button>
            </div>
          </div>
        )}
      </section>

      <details className="inspector-section workflow-section" open>
        <summary>
          <Goal size={16} aria-hidden />
          <strong>Meeting flow</strong>
        </summary>
        <div className="phase-card">
          <span>Step {activePhaseIndex + 1} / {phases.length}</span>
          <label>
            <span>Phase</span>
            <input
              value={activePhase.label}
              onChange={(event) => onUpdatePhase(activePhase.id, { label: event.target.value })}
            />
          </label>
          <label>
            <span>Prompt</span>
            <textarea
              value={activePhase.hint}
              onChange={(event) => onUpdatePhase(activePhase.id, { hint: event.target.value })}
            />
          </label>
          <label>
            <span>Template</span>
            <select
              value={activePhase.templateId}
              onChange={(event) => onUpdatePhase(activePhase.id, { templateId: event.target.value as ProductTemplateId })}
            >
              {productTemplates.map((template) => (
                <option key={template.id} value={template.id}>{template.label}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="phase-track" aria-label="Meeting phases">
          {phases.map((phase, index) => (
            <button
              key={phase.id}
              type="button"
              className={phase.id === activePhase.id ? 'active' : undefined}
              title={phase.hint}
              onClick={() => onPhaseChange(phase.id)}
            >
              <span>{index + 1}</span>
              <strong>{phase.label}</strong>
            </button>
          ))}
        </div>
        <div className="phase-actions">
          <button type="button" onClick={() => onPhaseStep(-1)} disabled={activePhaseIndex <= 0}>
            <ArrowUpToLine size={16} aria-hidden />
            <span>Prev</span>
          </button>
          <button type="button" onClick={onInsertPhaseTemplate}>
            <Copy size={16} aria-hidden />
            <span>Use template</span>
          </button>
          <button type="button" onClick={() => onPhaseStep(1)} disabled={activePhaseIndex >= phases.length - 1}>
            <ArrowDownToLine size={16} aria-hidden />
            <span>Next</span>
          </button>
        </div>
        <div className="phase-actions two">
          <button type="button" onClick={onAddPhase}>
            <BadgePlus size={16} aria-hidden />
            <span>Add phase</span>
          </button>
          <button type="button" onClick={() => onRemovePhase(activePhase.id)} disabled={phases.length <= 1}>
            <Trash2 size={16} aria-hidden />
            <span>Remove</span>
          </button>
        </div>
      </details>

      <details className="inspector-section workflow-section" open>
        <summary>
          <Search size={16} aria-hidden />
          <strong>Find and export</strong>
        </summary>
        <div className="product-actions">
          <button type="button" onClick={onCreateCard} title="New product card">
            <BadgePlus size={16} aria-hidden />
            <span>Card</span>
          </button>
          <label className="import-button" title="Import Markdown, TXT, CSV, or JSON">
            <FileInput size={16} aria-hidden />
            <span>Import</span>
            <input
              type="file"
              accept=".md,.markdown,.txt,.csv,.json,text/markdown,text/plain,application/json,text/csv"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                if (file) {
                  onImportFile(file);
                }
                event.currentTarget.value = '';
              }}
            />
          </label>
          <button type="button" onClick={onExportMarkdown} title="Export Markdown">
            <FileText size={16} aria-hidden />
            <span>MD</span>
          </button>
          <button type="button" onClick={onExportJson} title="Export JSON">
            <FileJson size={16} aria-hidden />
            <span>JSON</span>
          </button>
        </div>
        <label className="product-field">
          <span>Search</span>
          <div className="input-with-icon">
            <Search size={15} aria-hidden />
            <input value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder="tag, owner, title" />
          </div>
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
        <section className="product-summary">
          <div><strong>{cards.length}</strong><span>cards</span></div>
          <div><strong>{cards.reduce((sum, shape) => sum + (shape.attrs.votes ?? 0), 0)}</strong><span>votes</span></div>
          <div><strong>{visibleCards.length}</strong><span>shown</span></div>
        </section>
      </details>

      <details className="inspector-section templates-section">
        <summary>
          <Copy size={16} aria-hidden />
          <strong>Scenario templates</strong>
        </summary>
        <div className="template-catalog">
          {templateCategories.map((category) => (
            <section key={category}>
              <h3>{category}</h3>
              <div className="template-list">
                {productTemplates
                  .filter((template) => template.category === category)
                  .map((template) => {
                    const TemplateIcon = templateIcons[template.id];
                    return (
                      <button key={template.id} type="button" onClick={() => onTemplateInsert(template.id)} title={template.description}>
                        <TemplateIcon size={16} aria-hidden />
                        <span>
                          <strong>{template.label}</strong>
                          <small>{template.description}</small>
                        </span>
                      </button>
                    );
                  })}
              </div>
            </section>
          ))}
        </div>
      </details>

      <details className="inspector-section top-votes">
        <summary>
          <ThumbsUp size={16} aria-hidden />
          <strong>Top votes</strong>
        </summary>
        {topCards.length === 0 ? (
          <p>No cards yet</p>
        ) : topCards.map((shape) => (
          <div key={shape.id}>
            <span>{shape.attrs.title ?? 'Untitled'}</span>
            <strong><ThumbsUp size={13} aria-hidden /> {shape.attrs.votes ?? 0}</strong>
          </div>
        ))}
      </details>
    </aside>
  );
}

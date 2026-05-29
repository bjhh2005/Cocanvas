import type { CanvasShape } from '../store/shapeStore';
import type { ShapeAttrs, ShapeOperation, ShapeType } from '../types/protocol';

export type ProductTemplateId = 'swot' | 'journey' | 'matrix' | 'problem-solution' | 'kanban' | 'retro';

export const cardStatuses: NonNullable<ShapeAttrs['status']>[] = ['idea', 'todo', 'doing', 'done', 'blocked'];
export const cardPriorities: NonNullable<ShapeAttrs['priority']>[] = ['low', 'medium', 'high', 'urgent'];

export const cardPalette: Record<NonNullable<ShapeAttrs['priority']>, { fill: string; stroke: string; label: string }> = {
  low: { fill: '#e0f2fe', stroke: '#0369a1', label: 'Low' },
  medium: { fill: '#dcfce7', stroke: '#15803d', label: 'Medium' },
  high: { fill: '#fef3c7', stroke: '#b45309', label: 'High' },
  urgent: { fill: '#ffe4e6', stroke: '#be123c', label: 'Urgent' },
};

export const statusLabels: Record<NonNullable<ShapeAttrs['status']>, string> = {
  idea: 'Idea',
  todo: 'To do',
  doing: 'Doing',
  done: 'Done',
  blocked: 'Blocked',
};

export const priorityLabels: Record<NonNullable<ShapeAttrs['priority']>, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

export const tagOptions = ['Insight', 'Risk', 'User', 'Tech', 'Growth', 'Decision', 'Experiment', 'Follow-up'];

export const createId = (prefix: string) => (
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

export const createCardOp = (
  x: number,
  y: number,
  attrs: Partial<ShapeAttrs> = {}
): ShapeOperation => {
  const priority = attrs.priority ?? 'medium';
  const palette = cardPalette[priority];

  return {
    opType: 'create',
    shapeId: createId('card'),
    shapeType: 'card',
    attrs: {
      x,
      y,
      w: 260,
      h: 168,
      title: 'New idea',
      body: 'Describe the signal, decision, or next step.',
      tags: ['Insight'],
      priority,
      status: 'idea',
      assignee: '',
      votes: 0,
      voters: [],
      fill: palette.fill,
      stroke: palette.stroke,
      strokeWidth: 2,
      textColor: '#111827',
      fontSize: 16,
      cornerRadius: 8,
      zIndex: Date.now(),
      ...attrs,
    },
  };
};

const createFrame = (title: string, x: number, y: number, w: number, h: number): ShapeOperation => ({
  opType: 'create',
  shapeId: createId('frame'),
  shapeType: 'frame',
  attrs: {
    x,
    y,
    w,
    h,
    text: title,
    fill: 'rgba(255,255,255,0.02)',
    textColor: '#334155',
    fontSize: 20,
    stroke: '#64748b',
    strokeWidth: 2,
    zIndex: -10,
  },
});

export const productTemplates: Array<{ id: ProductTemplateId; label: string }> = [
  { id: 'swot', label: 'SWOT' },
  { id: 'journey', label: 'Journey' },
  { id: 'matrix', label: '2x2' },
  { id: 'problem-solution', label: 'Problem' },
  { id: 'kanban', label: 'Kanban' },
  { id: 'retro', label: 'Retro' },
];

export const createTemplateOps = (templateId: ProductTemplateId, originX: number, originY: number): ShapeOperation[] => {
  if (templateId === 'kanban') {
    const columns = [
      ['Backlog', 'todo'],
      ['Doing', 'doing'],
      ['Done', 'done'],
    ] as const;

    return columns.flatMap(([title, status], index) => {
      const x = originX + index * 300;
      return [
        createFrame(title, x, originY, 270, 460),
        createCardOp(x + 24, originY + 58, { title: `${title} item`, status, tags: ['Follow-up'] }),
      ];
    });
  }

  if (templateId === 'retro') {
    return [
      createFrame('Went well', originX, originY, 290, 360),
      createFrame('To improve', originX + 320, originY, 290, 360),
      createFrame('Actions', originX + 640, originY, 290, 360),
      createCardOp(originX + 24, originY + 58, { title: 'Keep', body: 'What should the team keep doing?', tags: ['Insight'] }),
      createCardOp(originX + 344, originY + 58, { title: 'Improve', body: 'What friction should be removed?', priority: 'high', tags: ['Risk'] }),
      createCardOp(originX + 664, originY + 58, { title: 'Action', body: 'Who owns the next step?', status: 'todo', tags: ['Follow-up'] }),
    ];
  }

  if (templateId === 'problem-solution') {
    return [
      createFrame('Problem', originX, originY, 290, 380),
      createFrame('Cause', originX + 320, originY, 290, 380),
      createFrame('Solution', originX + 640, originY, 290, 380),
      createCardOp(originX + 24, originY + 58, { title: 'Problem', body: 'What hurts users or the team?', priority: 'high', tags: ['User'] }),
      createCardOp(originX + 344, originY + 58, { title: 'Root cause', body: 'What keeps creating the problem?', tags: ['Risk'] }),
      createCardOp(originX + 664, originY + 58, { title: 'Solution', body: 'What experiment can prove it?', tags: ['Experiment'] }),
    ];
  }

  const frames = templateId === 'swot'
    ? ['Strengths', 'Weaknesses', 'Opportunities', 'Threats']
    : templateId === 'journey'
      ? ['Discover', 'Evaluate', 'Use', 'Return']
      : ['High value', 'Low effort', 'High effort', 'Low value'];

  return frames.flatMap((title, index) => {
    const x = originX + (index % 2) * 340;
    const y = originY + Math.floor(index / 2) * 300;
    return [
      createFrame(title, x, y, 310, 260),
      createCardOp(x + 24, y + 58, { title: `${title} note`, body: 'Add evidence, owner, and decision.', tags: [index % 2 === 0 ? 'Insight' : 'Risk'] }),
    ];
  });
};

export const shapeText = (shape: CanvasShape) => [
  shape.attrs.title,
  shape.attrs.body,
  shape.attrs.text,
  shape.attrs.assignee,
  ...(shape.attrs.tags ?? []),
  shape.type,
  shape.attrs.status,
  shape.attrs.priority,
].filter(Boolean).join(' ').toLowerCase();

export const isProductShape = (shape: CanvasShape) => (
  shape.type === 'card' ||
  shape.type === 'sticky' ||
  shape.type === 'comment' ||
  shape.type === 'text' ||
  shape.type === 'frame'
);

export const shapeToExportRecord = (shape: CanvasShape) => ({
  id: shape.id,
  type: shape.type,
  title: shape.attrs.title ?? shape.attrs.text ?? '',
  body: shape.attrs.body ?? '',
  tags: shape.attrs.tags ?? [],
  priority: shape.attrs.priority ?? '',
  status: shape.attrs.status ?? '',
  assignee: shape.attrs.assignee ?? '',
  votes: shape.attrs.votes ?? 0,
  resolved: shape.attrs.resolved ?? false,
  x: shape.attrs.x,
  y: shape.attrs.y,
});

export const exportMarkdown = (roomId: string, shapes: CanvasShape[]) => {
  const productShapes = shapes.filter(isProductShape).sort((a, b) => (
    (b.attrs.votes ?? 0) - (a.attrs.votes ?? 0) ||
    a.attrs.y - b.attrs.y ||
    a.attrs.x - b.attrs.x
  ));

  const lines = [
    `# Cocanvas ${roomId || 'board'} summary`,
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
  ];

  productShapes.forEach((shape) => {
    const record = shapeToExportRecord(shape);
    lines.push(`## ${record.title || shape.type}`);
    if (record.body) {
      lines.push('', record.body);
    }
    const meta = [
      record.status && `status: ${record.status}`,
      record.priority && `priority: ${record.priority}`,
      record.assignee && `assignee: ${record.assignee}`,
      record.votes ? `votes: ${record.votes}` : '',
      record.tags.length > 0 ? `tags: ${record.tags.join(', ')}` : '',
    ].filter(Boolean);
    if (meta.length > 0) {
      lines.push('', meta.map((item) => `- ${item}`).join('\n'));
    }
    lines.push('');
  });

  return lines.join('\n');
};

export const downloadTextFile = (filename: string, contents: string, mimeType: string) => {
  const blob = new Blob([contents], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = filename;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
};

export const normalizeShapeType = (shapeType: ShapeType) => shapeType;

import type { CanvasShape } from '../store/shapeStore';
import type { ShapeAttrs, ShapeOperation, ShapeType } from '../types/protocol';

export type ProductTemplateId =
  | 'swot'
  | 'journey'
  | 'matrix'
  | 'problem-solution'
  | 'kanban'
  | 'retro'
  | 'prd-review'
  | 'user-interview'
  | 'decision-matrix'
  | 'ice-prioritization'
  | 'rice-scoring'
  | 'risk-map'
  | 'incident-review'
  | 'gtm-plan'
  | 'experiment-plan';

export type ProductTemplate = {
  id: ProductTemplateId;
  label: string;
  description: string;
  category: '基础讨论' | '产品评审' | '优先级' | '复盘增长';
};

export type MeetingPhaseId = string;

export type MeetingPhase = {
  id: MeetingPhaseId;
  label: string;
  hint: string;
  templateId: ProductTemplateId;
};

export type ImportedBoardItem = {
  title: string;
  body?: string;
  section?: string;
  tags?: string[];
  status?: ShapeAttrs['status'];
  priority?: ShapeAttrs['priority'];
  assignee?: string;
};

export type BoardImportResult = {
  ops: ShapeOperation[];
  itemCount: number;
  sectionCount: number;
  format: 'json' | 'csv' | 'markdown' | 'text';
};

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

const createTextOp = (
  text: string,
  x: number,
  y: number,
  attrs: Partial<ShapeAttrs> = {}
): ShapeOperation => ({
  opType: 'create',
  shapeId: createId('text'),
  shapeType: 'text',
  attrs: {
    x,
    y,
    w: 740,
    h: 48,
    text,
    fill: 'transparent',
    stroke: 'transparent',
    strokeWidth: 0,
    textColor: '#0f172a',
    fontSize: 28,
    fontStyle: 'bold',
    zIndex: -4,
    ...attrs,
  },
});

const createConnectorOp = (
  from: ShapeOperation,
  to: ShapeOperation,
  fromAnchor: NonNullable<ShapeAttrs['fromAnchor']> = 'right',
  toAnchor: NonNullable<ShapeAttrs['toAnchor']> = 'left'
): ShapeOperation => ({
  opType: 'create',
  shapeId: createId('connector'),
  shapeType: 'connector',
  attrs: {
    x: from.attrs?.x ?? 0,
    y: from.attrs?.y ?? 0,
    fromShapeId: from.shapeId,
    toShapeId: to.shapeId,
    fromAnchor,
    toAnchor,
    stroke: '#475569',
    strokeWidth: 2,
    fill: 'transparent',
    arrowEnd: true,
    zIndex: -2,
  },
});

const card = (
  x: number,
  y: number,
  title: string,
  body: string,
  attrs: Partial<ShapeAttrs> = {}
) => createCardOp(x, y, { title, body, ...attrs });

const columnTemplate = (
  originX: number,
  originY: number,
  title: string,
  columns: Array<{ title: string; cardTitle: string; body: string; attrs?: Partial<ShapeAttrs> }>
) => [
  createTextOp(title, originX, originY - 66),
  ...columns.flatMap((column, index) => {
    const x = originX + index * 300;
    return [
      createFrame(column.title, x, originY, 270, 430),
      card(x + 24, originY + 58, column.cardTitle, column.body, column.attrs),
    ];
  }),
];

export const productTemplates: ProductTemplate[] = [
  { id: 'prd-review', label: 'PRD 评审', description: '目标、范围、风险、决策、行动项', category: '产品评审' },
  { id: 'user-interview', label: '访谈归纳', description: '原话、痛点、需求、机会、实验', category: '产品评审' },
  { id: 'decision-matrix', label: '决策矩阵', description: '方案按影响力和信心做选择', category: '优先级' },
  { id: 'ice-prioritization', label: 'ICE 排序', description: 'Impact / Confidence / Ease 快速排序', category: '优先级' },
  { id: 'rice-scoring', label: 'RICE 评分', description: 'Reach / Impact / Confidence / Effort', category: '优先级' },
  { id: 'risk-map', label: '风险地图', description: '概率和影响二维定位风险', category: '优先级' },
  { id: 'incident-review', label: '故障复盘', description: '时间线、影响、根因、改进动作', category: '复盘增长' },
  { id: 'gtm-plan', label: 'GTM 启动', description: '人群、信息、渠道、异议、上线任务', category: '复盘增长' },
  { id: 'experiment-plan', label: '实验设计', description: '假设、指标、方案、护栏、结论', category: '复盘增长' },
  { id: 'kanban', label: '看板', description: '待办、进行中、完成', category: '基础讨论' },
  { id: 'retro', label: 'Retro 复盘', description: '保持、改进、行动', category: '基础讨论' },
  { id: 'problem-solution', label: '问题方案', description: '问题、原因、解决方案', category: '基础讨论' },
  { id: 'swot', label: 'SWOT', description: '优势、劣势、机会、威胁', category: '基础讨论' },
  { id: 'journey', label: '用户旅程', description: '发现、评估、使用、回访', category: '基础讨论' },
  { id: 'matrix', label: '影响/成本', description: '价值和工作量二维拆解', category: '优先级' },
];

export const meetingPhases: MeetingPhase[] = [
  { id: 'prepare', label: '准备议题', hint: '先明确目标、参与者和需要拍板的问题。', templateId: 'prd-review' },
  { id: 'diverge', label: '发散想法', hint: '鼓励先写证据和问题，不急着评价。', templateId: 'problem-solution' },
  { id: 'cluster', label: '归类收敛', hint: '把相似信号合并到主题、旅程或象限里。', templateId: 'user-interview' },
  { id: 'vote', label: '投票排序', hint: '用投票或 ICE/RICE 选出最值得推进的方向。', templateId: 'ice-prioritization' },
  { id: 'decide', label: '形成决策', hint: '记录选择、取舍、风险和反对意见。', templateId: 'decision-matrix' },
  { id: 'actions', label: '行动项', hint: '把结论转成 owner、截止时间和验收标准。', templateId: 'kanban' },
];

export const createTemplateOps = (templateId: ProductTemplateId, originX: number, originY: number): ShapeOperation[] => {
  if (templateId === 'prd-review') {
    const goal = card(originX + 24, originY + 58, '本次评审目标', '要达成什么共识？例如确认 MVP 范围和上线判断标准。', { tags: ['Decision'], status: 'doing' });
    const user = card(originX + 324, originY + 58, '目标用户和场景', '谁在什么情况下遇到问题？补充证据来源。', { tags: ['User'] });
    const scope = card(originX + 624, originY + 58, '本期范围', '明确 Must / Should / Won’t，避免会中发散失控。', { tags: ['Decision'], priority: 'high' });
    const risk = card(originX + 24, originY + 318, '主要风险', '技术、数据、合规、体验或排期风险分别是什么？', { tags: ['Risk'], priority: 'urgent' });
    const decision = card(originX + 324, originY + 318, '待决策事项', '列出需要主持人或负责人拍板的选择。', { tags: ['Decision'], status: 'todo' });
    const action = card(originX + 624, originY + 318, '会后行动项', '谁在什么时候交付什么？', { tags: ['Follow-up'], status: 'todo' });
    return [
      createTextOp('PRD 评审讨论图', originX, originY - 66),
      createFrame('目标 / 用户 / 范围', originX, originY, 870, 246),
      createFrame('风险 / 决策 / 行动', originX, originY + 260, 870, 246),
      goal,
      user,
      scope,
      risk,
      decision,
      action,
      createConnectorOp(goal, scope),
      createConnectorOp(risk, decision),
      createConnectorOp(decision, action),
    ];
  }

  if (templateId === 'user-interview') {
    return columnTemplate(originX, originY, '用户访谈归纳图', [
      { title: '用户原话', cardTitle: '原话证据', body: '贴一句最能代表用户情绪或动机的原话。', attrs: { tags: ['User'], priority: 'low' } },
      { title: '痛点', cardTitle: '重复出现的问题', body: '用户在哪一步卡住？频率和损失是什么？', attrs: { tags: ['Risk'], priority: 'high' } },
      { title: '需求', cardTitle: '真实需求', body: '用户想完成的任务，不是直接照抄功能请求。', attrs: { tags: ['Insight'] } },
      { title: '机会', cardTitle: '产品机会', body: '如果解决这个需求，会改变哪个指标或体验？', attrs: { tags: ['Growth'] } },
      { title: '验证实验', cardTitle: '下一步实验', body: '用什么低成本方式验证机会是否成立？', attrs: { tags: ['Experiment'], status: 'todo' } },
    ]);
  }

  if (templateId === 'decision-matrix') {
    return [
      createTextOp('决策矩阵：影响力 x 信心', originX, originY - 66),
      createTextOp('高信心', originX + 316, originY - 28, { w: 160, h: 28, fontSize: 18 }),
      createTextOp('低信心', originX + 316, originY + 566, { w: 160, h: 28, fontSize: 18 }),
      createTextOp('低影响', originX - 78, originY + 266, { w: 120, h: 28, fontSize: 18 }),
      createTextOp('高影响', originX + 684, originY + 266, { w: 120, h: 28, fontSize: 18 }),
      createFrame('立即推进', originX + 340, originY, 310, 260),
      createFrame('小步验证', originX, originY, 310, 260),
      createFrame('押后观察', originX, originY + 300, 310, 260),
      createFrame('谨慎决策', originX + 340, originY + 300, 310, 260),
      card(originX + 364, originY + 58, '方案 A', '影响高、证据充分，可以进入行动项。', { tags: ['Decision'], status: 'todo', priority: 'high' }),
      card(originX + 24, originY + 58, '方案 B', '信心高但收益较小，适合作为快速优化。', { tags: ['Experiment'], priority: 'medium' }),
      card(originX + 364, originY + 358, '方案 C', '收益可能大，但需要补证据。', { tags: ['Risk'], priority: 'urgent' }),
    ];
  }

  if (templateId === 'ice-prioritization') {
    return columnTemplate(originX, originY, 'ICE 优先级排序', [
      { title: 'Impact', cardTitle: '影响力', body: '这个想法会明显改善哪个结果？1-10 分。', attrs: { tags: ['Growth'], priority: 'high' } },
      { title: 'Confidence', cardTitle: '信心', body: '我们有多少证据相信它有效？1-10 分。', attrs: { tags: ['Insight'] } },
      { title: 'Ease', cardTitle: '容易度', body: '实现、验证和上线的成本多低？1-10 分。', attrs: { tags: ['Tech'] } },
      { title: 'Score', cardTitle: 'ICE = I x C x E', body: '把高分项移到行动区，低信心项先补实验。', attrs: { tags: ['Decision'], status: 'todo' } },
    ]);
  }

  if (templateId === 'rice-scoring') {
    return columnTemplate(originX, originY, 'RICE 评分讨论图', [
      { title: 'Reach', cardTitle: '触达人数', body: '一段周期内会影响多少用户或客户？', attrs: { tags: ['Growth'] } },
      { title: 'Impact', cardTitle: '单人影响', body: '对每个被触达用户的体验或收入影响有多大？', attrs: { tags: ['Insight'], priority: 'high' } },
      { title: 'Confidence', cardTitle: '证据信心', body: '数据、访谈、竞品或历史实验支持到什么程度？', attrs: { tags: ['Decision'] } },
      { title: 'Effort', cardTitle: '投入成本', body: '需要多少人周？有哪些依赖？', attrs: { tags: ['Tech'], priority: 'medium' } },
      { title: 'Decision', cardTitle: '排序结论', body: 'RICE = Reach x Impact x Confidence / Effort。', attrs: { tags: ['Follow-up'], status: 'todo' } },
    ]);
  }

  if (templateId === 'risk-map') {
    return [
      createTextOp('风险地图：概率 x 影响', originX, originY - 66),
      createFrame('高概率 / 高影响', originX + 340, originY, 310, 260),
      createFrame('低概率 / 高影响', originX + 340, originY + 300, 310, 260),
      createFrame('高概率 / 低影响', originX, originY, 310, 260),
      createFrame('低概率 / 低影响', originX, originY + 300, 310, 260),
      card(originX + 364, originY + 58, '红区风险', '必须有负责人、缓解方案和截止日期。', { tags: ['Risk'], priority: 'urgent', status: 'todo' }),
      card(originX + 24, originY + 58, '频繁小风险', '用流程、监控或自动化降低发生频率。', { tags: ['Tech'], priority: 'medium' }),
      card(originX + 364, originY + 358, '黑天鹅预案', '先准备回滚、兜底和沟通方案。', { tags: ['Risk'], priority: 'high' }),
    ];
  }

  if (templateId === 'incident-review') {
    return columnTemplate(originX, originY, '故障复盘讨论图', [
      { title: 'Timeline', cardTitle: '关键时间线', body: '发现、确认、止血、恢复分别发生在什么时候？', attrs: { tags: ['Insight'] } },
      { title: 'Impact', cardTitle: '影响范围', body: '影响了哪些用户、功能、收入或 SLA？', attrs: { tags: ['Risk'], priority: 'urgent' } },
      { title: 'Root cause', cardTitle: '根因', body: '技术根因和流程根因分别是什么？', attrs: { tags: ['Tech'], priority: 'high' } },
      { title: 'Worked', cardTitle: '有效动作', body: '哪些监控、协作或预案帮了忙？', attrs: { tags: ['Insight'], priority: 'low' } },
      { title: 'Actions', cardTitle: '防复发行动', body: '每个行动项必须有负责人和截止时间。', attrs: { tags: ['Follow-up'], status: 'todo' } },
    ]);
  }

  if (templateId === 'gtm-plan') {
    return columnTemplate(originX, originY, 'GTM 上线讨论图', [
      { title: 'Segment', cardTitle: '目标人群', body: '首批面向谁？他们为什么现在需要？', attrs: { tags: ['User'] } },
      { title: 'Message', cardTitle: '核心信息', body: '一句话价值主张，不要写功能清单。', attrs: { tags: ['Growth'], priority: 'high' } },
      { title: 'Channel', cardTitle: '触达渠道', body: '站内、销售、社群、内容、广告分别怎么用？', attrs: { tags: ['Growth'] } },
      { title: 'Objection', cardTitle: '用户异议', body: '用户为什么不买、不试或不用？', attrs: { tags: ['Risk'], priority: 'high' } },
      { title: 'Launch tasks', cardTitle: '上线任务', body: '物料、埋点、客服、监控和复盘时间。', attrs: { tags: ['Follow-up'], status: 'todo' } },
    ]);
  }

  if (templateId === 'experiment-plan') {
    return columnTemplate(originX, originY, '实验设计讨论图', [
      { title: 'Hypothesis', cardTitle: '实验假设', body: '如果我们做 X，目标用户会因为 Y 而完成 Z。', attrs: { tags: ['Experiment'], priority: 'high' } },
      { title: 'Metric', cardTitle: '主指标', body: '用哪个指标判断成功？基线和目标是多少？', attrs: { tags: ['Growth'] } },
      { title: 'Variant', cardTitle: '实验方案', body: '控制组和实验组差异是什么？', attrs: { tags: ['Tech'] } },
      { title: 'Guardrail', cardTitle: '护栏指标', body: '哪些指标恶化时必须停止实验？', attrs: { tags: ['Risk'], priority: 'urgent' } },
      { title: 'Decision', cardTitle: '结论动作', body: '上线、迭代、继续观察还是放弃？', attrs: { tags: ['Decision'], status: 'todo' } },
    ]);
  }

  if (templateId === 'kanban') {
    const columns = [
      ['Backlog', 'todo'],
      ['Doing', 'doing'],
      ['Done', 'done'],
    ] as const;

    return [
      createTextOp('任务看板', originX, originY - 66),
      ...columns.flatMap(([title, status], index) => {
      const x = originX + index * 300;
      return [
        createFrame(title, x, originY, 270, 460),
        createCardOp(x + 24, originY + 58, { title: `${title} item`, status, tags: ['Follow-up'] }),
      ];
      }),
    ];
  }

  if (templateId === 'retro') {
    return [
      createTextOp('团队复盘', originX, originY - 66),
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
      createTextOp('问题 - 原因 - 方案', originX, originY - 66),
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
      ...(index === 0 ? [createTextOp(
        templateId === 'swot' ? 'SWOT 分析' : templateId === 'journey' ? '用户旅程图' : '影响力 / 工作量矩阵',
        originX,
        originY - 66
      )] : []),
      createFrame(title, x, y, 310, 260),
      createCardOp(x + 24, y + 58, { title: `${title} note`, body: 'Add evidence, owner, and decision.', tags: [index % 2 === 0 ? 'Insight' : 'Risk'] }),
    ];
  });
};

const statusAliases: Record<string, NonNullable<ShapeAttrs['status']>> = {
  idea: 'idea',
  backlog: 'todo',
  todo: 'todo',
  'to do': 'todo',
  doing: 'doing',
  progress: 'doing',
  'in progress': 'doing',
  done: 'done',
  complete: 'done',
  completed: 'done',
  blocked: 'blocked',
  block: 'blocked',
};

const priorityAliases: Record<string, NonNullable<ShapeAttrs['priority']>> = {
  low: 'low',
  medium: 'medium',
  med: 'medium',
  high: 'high',
  urgent: 'urgent',
  p0: 'urgent',
  p1: 'high',
  p2: 'medium',
  p3: 'low',
};

const normalizeStatus = (value: unknown): ShapeAttrs['status'] => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return statusAliases[value.trim().toLowerCase()];
};

const normalizePriority = (value: unknown): ShapeAttrs['priority'] => {
  if (typeof value !== 'string') {
    return undefined;
  }

  return priorityAliases[value.trim().toLowerCase()];
};

const normalizeTags = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map(String).map((tag) => tag.trim()).filter(Boolean);
  }

  if (typeof value !== 'string') {
    return [];
  }

  return value
    .split(/[;,#，、]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
};

const asString = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const splitCsvLine = (line: string) => {
  const cells: string[] = [];
  let current = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === ',' && !quoted) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }

  cells.push(current.trim());
  return cells;
};

const parseCsv = (contents: string): ImportedBoardItem[] => {
  const lines = contents.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const headers = splitCsvLine(lines[0]).map((header) => header.trim().toLowerCase());
  const hasHeader = headers.some((header) => ['title', 'body', 'section', 'tags', 'status', 'priority', 'assignee'].includes(header));
  const dataLines = hasHeader ? lines.slice(1) : lines;
  const effectiveHeaders = hasHeader ? headers : ['title', 'body', 'section', 'tags', 'status', 'priority', 'assignee'];

  return dataLines.map((line) => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(effectiveHeaders.map((header, index) => [header, cells[index] ?? '']));
    return {
      title: row.title || row.name || cells[0] || 'Imported card',
      body: row.body || row.description || cells[1] || '',
      section: row.section || row.column || row.group || '',
      tags: normalizeTags(row.tags),
      status: normalizeStatus(row.status),
      priority: normalizePriority(row.priority),
      assignee: row.assignee || row.owner || '',
    };
  }).filter((item) => item.title.trim() !== '');
};

const parseJsonItems = (contents: string): ImportedBoardItem[] => {
  const parsed = JSON.parse(contents) as unknown;
  const records = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { cards?: unknown[] }).cards)
      ? (parsed as { cards: unknown[] }).cards
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as { items?: unknown[] }).items)
        ? (parsed as { items: unknown[] }).items
        : [];

  return records
    .filter((record): record is Record<string, unknown> => Boolean(record) && typeof record === 'object' && !Array.isArray(record))
    .map((record) => ({
      title: asString(record.title) || asString(record.name) || asString(record.text) || 'Imported card',
      body: asString(record.body) || asString(record.description) || asString(record.content),
      section: asString(record.section) || asString(record.column) || asString(record.group),
      tags: normalizeTags(record.tags),
      status: normalizeStatus(record.status),
      priority: normalizePriority(record.priority),
      assignee: asString(record.assignee) || asString(record.owner),
    }));
};

const parseMarkdown = (contents: string): ImportedBoardItem[] => {
  const items: ImportedBoardItem[] = [];
  let section = 'Imported';
  let current: ImportedBoardItem | null = null;

  const flush = () => {
    if (current && current.title.trim()) {
      items.push({
        ...current,
        body: current.body?.trim(),
        section: current.section || section,
      });
    }
    current = null;
  };

  contents.split(/\r?\n/).forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    const heading = line.match(/^(#{1,3})\s+(.+)$/);
    if (heading) {
      flush();
      if (heading[1].length <= 2) {
        section = heading[2].trim();
      } else {
        current = { title: heading[2].trim(), section };
      }
      return;
    }

    const task = line.match(/^[-*]\s+\[( |x|X)\]\s+(.+)$/);
    const bullet = line.match(/^[-*]\s+(.+)$/);
    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    const match = task ?? bullet ?? numbered;
    if (match) {
      flush();
      const text = (task ? task[2] : match[1]).trim();
      current = {
        title: text,
        section,
        status: task ? (task[1].toLowerCase() === 'x' ? 'done' : 'todo') : 'idea',
      };
      return;
    }

    if (!current) {
      current = { title: line.slice(0, 80), section };
      return;
    }

    current.body = [current.body, line].filter(Boolean).join('\n');
  });

  flush();
  return items;
};

const parsePlainText = (contents: string): ImportedBoardItem[] => contents
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => ({
    title: line.length > 80 ? `${line.slice(0, 77)}...` : line,
    body: line.length > 80 ? line : '',
    section: 'Imported',
    status: 'idea' as const,
  }));

const detectImportFormat = (filename: string, contents: string): BoardImportResult['format'] => {
  const lowerName = filename.toLowerCase();
  if (lowerName.endsWith('.json')) {
    return 'json';
  }
  if (lowerName.endsWith('.csv')) {
    return 'csv';
  }
  if (lowerName.endsWith('.md') || lowerName.endsWith('.markdown')) {
    return 'markdown';
  }
  if (contents.trim().startsWith('{') || contents.trim().startsWith('[')) {
    return 'json';
  }
  if (contents.split(/\r?\n/)[0]?.includes(',')) {
    return 'csv';
  }
  if (/^#{1,3}\s+/m.test(contents) || /^[-*]\s+/m.test(contents)) {
    return 'markdown';
  }
  return 'text';
};

export const createImportOps = (
  filename: string,
  contents: string,
  originX: number,
  originY: number
): BoardImportResult => {
  const format = detectImportFormat(filename, contents);
  const items = format === 'json'
    ? parseJsonItems(contents)
    : format === 'csv'
      ? parseCsv(contents)
      : format === 'markdown'
        ? parseMarkdown(contents)
        : parsePlainText(contents);

  const sections = [...new Set(items.map((item) => item.section || 'Imported'))];
  const ops: ShapeOperation[] = [
    createTextOp(`Imported: ${filename || 'notes'}`, originX, originY - 66, { w: 840 }),
  ];

  sections.forEach((section, sectionIndex) => {
    const sectionItems = items.filter((item) => (item.section || 'Imported') === section);
    const x = originX + sectionIndex * 300;
    const frameHeight = Math.max(280, 96 + Math.ceil(sectionItems.length / 2) * 190);
    ops.push(createFrame(section, x, originY, 270, frameHeight));
    sectionItems.forEach((item, index) => {
      ops.push(createCardOp(x + 24, originY + 58 + index * 188, {
        title: item.title || 'Imported card',
        body: item.body || '',
        tags: item.tags && item.tags.length > 0 ? item.tags : ['Imported'],
        status: item.status ?? 'idea',
        priority: item.priority ?? 'medium',
        assignee: item.assignee ?? '',
      }));
    });
  });

  return {
    ops,
    itemCount: items.length,
    sectionCount: sections.length,
    format,
  };
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

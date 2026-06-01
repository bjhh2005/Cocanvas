import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const defaultOptions = {
  count: 120,
  sections: 6,
  format: 'json',
  out: '',
  seed: 42,
  prefix: 'Fixture',
};

const statuses = ['idea', 'todo', 'doing', 'done', 'blocked'];
const priorities = ['low', 'medium', 'high', 'urgent'];
const tagPool = ['Insight', 'Risk', 'User', 'Tech', 'Growth', 'Decision', 'Experiment', 'Follow-up'];
const topicPool = [
  'routing ownership',
  'history restore',
  'snapshot pruning',
  'join token',
  'member permission',
  'transient cursor',
  'AI generated ops',
  'cache hit rate',
  'queue backpressure',
  'whiteboard import',
  'large board viewport',
  'presentation demo',
];

const usage = () => `
Usage:
  node scripts/generate-board-fixture.mjs [options]

Options:
  --count <n>       Number of cards to generate. Default: ${defaultOptions.count}
  --sections <n>    Number of board sections. Default: ${defaultOptions.sections}
  --format <type>   json, csv, markdown, or text. Default: ${defaultOptions.format}
  --out <path>      Write to a file. If omitted, prints to stdout.
  --seed <n>        Deterministic random seed. Default: ${defaultOptions.seed}
  --prefix <text>   Title prefix. Default: ${defaultOptions.prefix}

Examples:
  node scripts/generate-board-fixture.mjs --count 500 --format json --out tmp/large-board.json
  node scripts/generate-board-fixture.mjs --count 80 --sections 4 --format csv
`;

const parseArgs = (argv) => {
  const options = { ...defaultOptions };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === '--help' || key === '-h') {
      options.help = true;
      continue;
    }
    if (!key.startsWith('--')) {
      throw new Error(`unexpected argument: ${key}`);
    }
    if (value === undefined || value.startsWith('--')) {
      throw new Error(`missing value for ${key}`);
    }
    index += 1;
    if (key === '--count') {
      options.count = asPositiveInt(value, key);
    } else if (key === '--sections') {
      options.sections = asPositiveInt(value, key);
    } else if (key === '--format') {
      options.format = value.toLowerCase();
    } else if (key === '--out') {
      options.out = value;
    } else if (key === '--seed') {
      options.seed = asPositiveInt(value, key);
    } else if (key === '--prefix') {
      options.prefix = value;
    } else {
      throw new Error(`unknown option: ${key}`);
    }
  }

  if (!['json', 'csv', 'markdown', 'text'].includes(options.format)) {
    throw new Error(`unsupported format: ${options.format}`);
  }
  return options;
};

const asPositiveInt = (value, key) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return parsed;
};

const createRandom = (seed) => {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

const pick = (items, random) => items[Math.floor(random() * items.length) % items.length];

const makeSections = (count) => Array.from({ length: count }, (_, index) => {
  const names = [
    'Architecture',
    'Reliability',
    'Collaboration',
    'Security',
    'Performance',
    'Demo Flow',
    'AI Assistant',
    'Operations',
  ];
  return names[index] ?? `Section ${index + 1}`;
});

const makeBody = (index, topic, section) => [
  `Validate ${topic} in the ${section} area.`,
  `Expected evidence: API response, WebSocket event, or board import result ${index + 1}.`,
  `Use this generated card as low-risk fixture data for demos and stress checks.`,
].join(' ');

const makeItems = (options) => {
  const random = createRandom(options.seed);
  const sectionNames = makeSections(options.sections);
  return Array.from({ length: options.count }, (_, index) => {
    const section = sectionNames[index % sectionNames.length];
    const topic = pick(topicPool, random);
    const tagA = pick(tagPool, random);
    const tagB = pick(tagPool.filter((tag) => tag !== tagA), random);
    return {
      title: `${options.prefix} ${String(index + 1).padStart(3, '0')} - ${topic}`,
      body: makeBody(index, topic, section),
      section,
      tags: [tagA, tagB],
      status: statuses[index % statuses.length],
      priority: priorities[Math.floor(random() * priorities.length)],
      assignee: `owner-${(index % 8) + 1}`,
    };
  });
};

const escapeCsvCell = (value) => {
  const text = Array.isArray(value) ? value.join(';') : String(value ?? '');
  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
};

const renderJson = (items) => `${JSON.stringify({ cards: items }, null, 2)}\n`;

const renderCsv = (items) => {
  const headers = ['title', 'body', 'section', 'tags', 'status', 'priority', 'assignee'];
  const lines = [
    headers.join(','),
    ...items.map((item) => headers.map((header) => escapeCsvCell(item[header])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
};

const renderMarkdown = (items) => {
  const grouped = groupBySection(items);
  const lines = ['# Generated Cocanvas Board Fixture', ''];
  for (const [section, sectionItems] of grouped.entries()) {
    lines.push(`## ${section}`, '');
    for (const item of sectionItems) {
      lines.push(`- [${item.status === 'done' ? 'x' : ' '}] ${item.title}`);
      lines.push(`  ${item.body}`);
      lines.push(`  tags: ${item.tags.join(', ')}; priority: ${item.priority}; assignee: ${item.assignee}`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
};

const groupBySection = (items) => {
  const grouped = new Map();
  for (const item of items) {
    const sectionItems = grouped.get(item.section) ?? [];
    sectionItems.push(item);
    grouped.set(item.section, sectionItems);
  }
  return grouped;
};

const renderText = (items) => `${items.map((item) => `${item.section}: ${item.title} - ${item.body}`).join('\n')}\n`;

const render = (items, format) => {
  if (format === 'json') {
    return renderJson(items);
  }
  if (format === 'csv') {
    return renderCsv(items);
  }
  if (format === 'markdown') {
    return renderMarkdown(items);
  }
  return renderText(items);
};

const main = async () => {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const items = makeItems(options);
  const output = render(items, options.format);
  if (!options.out) {
    process.stdout.write(output);
    return;
  }

  const target = resolve(options.out);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, output, 'utf8');
  console.log(`fixture_written path=${target} format=${options.format} count=${items.length}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

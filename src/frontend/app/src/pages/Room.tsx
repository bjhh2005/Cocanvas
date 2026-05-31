import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlignCenter,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpToLine,
  Copy,
  Goal,
  ImageDown,
  Keyboard,
  Link2,
  MessageSquarePlus,
  Lock as LockIcon,
  MousePointer2,
  PlusCircle,
  Undo2,
  Redo2,
  Unlink2,
  Scissors,
  Trash2,
  UserPlus,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CanvasBoard, type SelectionChangeOptions, type ViewportState } from '../components/CanvasBoard';
import { CursorLayer } from '../components/CursorLayer';
import { MeetingBar } from '../components/MeetingBar';
import { ProductPanel } from '../components/ProductPanel';
import { Toolbar, type ToolMode } from '../components/Toolbar';
import { UserIdentityEditor } from '../components/UserIdentityEditor';
import { HybridLogicalClock } from '../crdt/hlc';
import {
  claimRoomOwner,
  getRoom,
  getRoomHistory,
  fetchCacheStats,
  fetchQueueStats,
  fetchHistoryAnchors,
  listRoomMembers,
  removeRoomMember,
  upsertRoomMember,
  type HistoryResponse,
  type CacheStatsResponse,
  type QueueStatsResponse,
  type HistoryAnchors,
  type RoomMember,
} from '../network/api';
import { WSClient } from '../network/websocket';
import { useConnectionStore } from '../store/connectionStore';
import { useShapeStore, type CanvasShape } from '../store/shapeStore';
import { useUserStore } from '../store/userStore';
import type { ServerMessage, ShapeAttrs, ShapeOperation, ShapeType } from '../types/protocol';
import {
  cardPalette,
  createCardOp,
  createImportOps,
  createTemplateOps,
  downloadTextFile,
  exportMarkdown,
  meetingPhases,
  shapeText,
  shapeToExportRecord,
  type MeetingPhase,
  type MeetingPhaseId,
  type ProductTemplateId,
} from '../whiteboard/productBoard';
import { createShapeOp } from '../whiteboard/shapeFactory';

const cursorIntervalMs = 50;
const cursorMinScreenDistance = 3;
const cursorTinyMoveRefreshMs = 250;
const shapePreviewIntervalMs = 50;
const reconnectDelays = [1000, 2000, 4000, 8000, 15000];
const pendingOpsStoragePrefix = 'cocanvas:pending-ops:';
const draggableCreateTools = new Set<ToolMode>([
  'sticky',
  'card',
  'text',
  'rect',
  'roundedRect',
  'circle',
  'diamond',
  'triangle',
  'comment',
]);

const aiShapeTypes = new Set<ShapeType>([
  'rect',
  'roundedRect',
  'circle',
  'diamond',
  'triangle',
  'text',
  'sticky',
  'connector',
  'pen',
  'comment',
  'frame',
  'card',
]);

const isDraggableCreateTool = (tool: string): tool is Extract<ShapeType, ToolMode> => (
  draggableCreateTools.has(tool as ToolMode)
);

type HistoryEntry = {
  undo: ShapeOperation[];
  redo: ShapeOperation[];
};

type RemoteCursorUpdate = {
  userId: string;
  x: number;
  y: number;
  displayName?: string;
  color?: string;
};

type PenPreviewState = { points: number[]; stroke?: string; strokeWidth?: number };

const cloneShapeAttrs = (attrs: ShapeAttrs = {}): ShapeAttrs => ({
  ...attrs,
  tags: attrs.tags ? [...attrs.tags] : attrs.tags,
  voters: attrs.voters ? [...attrs.voters] : attrs.voters,
  points: attrs.points ? [...attrs.points] : attrs.points,
});

const cloneOpForHistory = (op: ShapeOperation): ShapeOperation => ({
  opType: op.opType,
  shapeId: op.shapeId,
  shapeType: op.shapeType,
  attrs: cloneShapeAttrs(op.attrs),
});

const msgId = () => {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `m-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const toRelativePoint = (event: React.MouseEvent<HTMLDivElement>) => {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: Math.round(event.clientX - rect.left),
    y: Math.round(event.clientY - rect.top),
  };
};

declare global {
  interface Window {
    __cocanvasPerfSeed?: (count: number) => { count: number; firstId: string };
  }
}

const resolveWsUrl = (wsUrl: string) => {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  try {
    const url = new URL(wsUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return `${protocol}//${window.location.host}${url.pathname}${url.search}`;
    }

    return wsUrl;
  } catch {
    return `${protocol}//${window.location.host}${wsUrl.startsWith('/') ? wsUrl : `/${wsUrl}`}`;
  }
};

const parseSnapshotPayload = (payload: string) => {
  const parsed = JSON.parse(payload || '{}') as unknown;
  if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
    return parsed as Parameters<ReturnType<typeof useShapeStore.getState>['replaceWithSnapshot']>[0];
  }

  return {};
};

const aiPriorities = new Set(['low', 'medium', 'high', 'urgent']);
const aiStatuses = new Set(['idea', 'todo', 'doing', 'done', 'blocked']);
const aiAnchors = new Set(['top', 'right', 'bottom', 'left', 'center']);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const safeText = (value: unknown, maxLength = 500) => (
  typeof value === 'string' ? value.trim().slice(0, maxLength) : undefined
);

const safeNumber = (value: unknown, min: number, max: number) => (
  typeof value === 'number' && Number.isFinite(value)
    ? Math.round(Math.max(min, Math.min(max, value)))
    : undefined
);

const safeStringArray = (value: unknown) => (
  Array.isArray(value)
    ? value
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.trim().slice(0, 40))
      .filter(Boolean)
      .slice(0, 8)
    : undefined
);

const safeNumberArray = (value: unknown) => (
  Array.isArray(value)
    ? value
      .filter((item): item is number => typeof item === 'number' && Number.isFinite(item))
      .map((item) => Math.round(Math.max(-100_000, Math.min(100_000, item))))
      .slice(0, 256)
    : undefined
);

const safeShapeRef = (value: unknown) => {
  const text = safeText(value, 120);
  return text && text.length > 0 ? text : undefined;
};

const withAiDefaults = (attrs: ShapeAttrs, shapeType: ShapeType, index: number): ShapeAttrs => {
  attrs.x ??= 220 + index * 36;
  attrs.y ??= 180 + index * 36;

  if (shapeType === 'card') {
    attrs.w ??= 260;
    attrs.h ??= 180;
    attrs.title ??= 'AI 生成卡片';
    attrs.body ??= '补充更多细节后即可用于讨论。';
    attrs.tags ??= ['AI'];
    attrs.priority ??= 'medium';
    attrs.status ??= 'idea';
    attrs.fill ??= '#dcfce7';
    attrs.stroke ??= '#15803d';
    attrs.textColor ??= '#111827';
    attrs.fontSize ??= 16;
    attrs.cornerRadius ??= 8;
    attrs.strokeWidth ??= 2;
  } else if (shapeType === 'sticky') {
    attrs.w ??= 190;
    attrs.h ??= 170;
    attrs.text ??= 'AI idea';
    attrs.fill ??= '#ffd966';
    attrs.stroke ??= 'transparent';
    attrs.textColor ??= '#202124';
    attrs.fontSize ??= 22;
    attrs.cornerRadius ??= 10;
    attrs.strokeWidth ??= 0;
  } else if (shapeType === 'text') {
    attrs.w ??= 740;
    attrs.h ??= 48;
    attrs.text ??= 'AI 生成内容';
    attrs.fill ??= 'transparent';
    attrs.stroke ??= 'transparent';
    attrs.strokeWidth ??= 0;
    attrs.textColor ??= '#0f172a';
    attrs.fontSize ??= 28;
    attrs.fontStyle ??= 'bold';
  } else if (shapeType === 'frame') {
    attrs.w ??= 280;
    attrs.h ??= 460;
    attrs.text ??= 'AI 分组';
    attrs.fill ??= 'rgba(255,255,255,0.02)';
    attrs.stroke ??= '#64748b';
    attrs.strokeWidth ??= 2;
    attrs.textColor ??= '#334155';
    attrs.fontSize ??= 20;
    attrs.zIndex ??= -10;
  } else if (shapeType === 'connector') {
    attrs.fill ??= 'transparent';
    attrs.stroke ??= '#475569';
    attrs.strokeWidth ??= 2;
    attrs.arrowEnd ??= true;
    attrs.fromAnchor ??= 'right';
    attrs.toAnchor ??= 'left';
    attrs.zIndex ??= -2;
  } else if (shapeType === 'circle') {
    attrs.radius ??= 50;
    attrs.fill ??= '#dcfce7';
    attrs.stroke ??= '#16a34a';
    attrs.strokeWidth ??= 2;
    attrs.textColor ??= '#14532d';
    attrs.fontSize ??= 14;
  } else if (shapeType === 'diamond' || shapeType === 'triangle') {
    attrs.w ??= 160;
    attrs.h ??= 120;
    attrs.fill ??= '#fef9c3';
    attrs.stroke ??= '#ca8a04';
    attrs.strokeWidth ??= 2;
    attrs.textColor ??= '#713f12';
    attrs.fontSize ??= 15;
  } else if (shapeType === 'comment') {
    attrs.w ??= 220;
    attrs.h ??= 86;
    attrs.text ??= 'AI 批注';
    attrs.fill ??= '#ffffff';
    attrs.stroke ??= '#e5e7eb';
    attrs.strokeWidth ??= 1;
    attrs.textColor ??= '#111827';
    attrs.fontSize ??= 14;
    attrs.cornerRadius ??= 8;
    attrs.resolved ??= false;
  } else if (shapeType === 'pen') {
    attrs.points ??= [];
    attrs.fill ??= 'transparent';
    attrs.stroke ??= '#111827';
    attrs.strokeWidth ??= 3;
  } else {
    attrs.w ??= shapeType === 'roundedRect' ? 160 : 140;
    attrs.h ??= shapeType === 'roundedRect' ? 90 : 80;
    attrs.fill ??= '#dbeafe';
    attrs.stroke ??= '#2563eb';
    attrs.strokeWidth ??= 2;
    attrs.textColor ??= '#1e3a8a';
    attrs.fontSize ??= 16;
    attrs.cornerRadius ??= shapeType === 'roundedRect' ? 18 : 0;
  }

  return attrs;
};

const sanitizeAiAttrs = (
  rawAttrs: unknown,
  shapeType: ShapeType,
  index: number,
  applyDefaults: boolean
): ShapeAttrs => {
  const source = isRecord(rawAttrs) ? rawAttrs : {};

  const attrs: ShapeAttrs = {};
  const x = safeNumber(source.x, -100_000, 100_000);
  const y = safeNumber(source.y, -100_000, 100_000);
  attrs.x = x;
  attrs.y = y;
  attrs.w = safeNumber(source.w, 20, 2_000);
  attrs.h = safeNumber(source.h, 20, 2_000);
  attrs.radius = safeNumber(source.radius, 0, 300);
  attrs.strokeWidth = safeNumber(source.strokeWidth, 0, 24);
  attrs.fontSize = safeNumber(source.fontSize, 8, 72);
  attrs.cornerRadius = safeNumber(source.cornerRadius, 0, 300);
  attrs.zIndex = safeNumber(source.zIndex, -1_000, 1_000);
  attrs.votes = safeNumber(source.votes, 0, 999);
  attrs.fill = safeText(source.fill, 80);
  attrs.stroke = safeText(source.stroke, 80);
  attrs.text = safeText(source.text);
  attrs.textColor = safeText(source.textColor, 80);
  attrs.fontStyle = safeText(source.fontStyle, 40);
  attrs.title = safeText(source.title);
  attrs.body = safeText(source.body, 1200);
  attrs.assignee = safeText(source.assignee, 80);
  attrs.tags = safeStringArray(source.tags);
  attrs.voters = safeStringArray(source.voters);
  attrs.points = shapeType === 'pen' ? safeNumberArray(source.points) : undefined;
  attrs.fromShapeId = shapeType === 'connector' ? safeShapeRef(source.fromShapeId) : undefined;
  attrs.toShapeId = shapeType === 'connector' ? safeShapeRef(source.toShapeId) : undefined;
  attrs.fromAnchor = typeof source.fromAnchor === 'string' && aiAnchors.has(source.fromAnchor)
    ? source.fromAnchor as ShapeAttrs['fromAnchor']
    : undefined;
  attrs.toAnchor = typeof source.toAnchor === 'string' && aiAnchors.has(source.toAnchor)
    ? source.toAnchor as ShapeAttrs['toAnchor']
    : undefined;
  attrs.priority = typeof source.priority === 'string' && aiPriorities.has(source.priority)
    ? source.priority as ShapeAttrs['priority']
    : undefined;
  attrs.status = typeof source.status === 'string' && aiStatuses.has(source.status)
    ? source.status as ShapeAttrs['status']
    : undefined;
  attrs.resolved = typeof source.resolved === 'boolean' ? source.resolved : undefined;
  attrs.arrowEnd = typeof source.arrowEnd === 'boolean' ? source.arrowEnd : undefined;

  const cleaned = Object.fromEntries(
    Object.entries(attrs).filter(([, value]) => value !== undefined)
  ) as ShapeAttrs;

  return applyDefaults ? withAiDefaults(cleaned, shapeType, index) : cleaned;
};

const sanitizeAiOp = (raw: unknown, index: number): ShapeOperation | null => {
  if (!isRecord(raw) || typeof raw.shapeType !== 'string') {
    return null;
  }

  if (raw.opType !== 'create' && raw.opType !== 'update' && raw.opType !== 'delete') {
    return null;
  }

  if (!aiShapeTypes.has(raw.shapeType as ShapeType)) {
    return null;
  }

  const shapeType = raw.shapeType as ShapeType;
  const shapeId = safeShapeRef(raw.shapeId) ?? (raw.opType === 'create' ? `ai-${msgId()}` : undefined);
  if (!shapeId) {
    return null;
  }

  if (raw.opType === 'delete') {
    return {
      opType: 'delete',
      shapeId,
      shapeType,
    };
  }

  const attrs = sanitizeAiAttrs(raw.attrs, shapeType, index, raw.opType === 'create');
  if (raw.opType === 'update' && Object.keys(attrs).length === 0) {
    return null;
  }

  return {
    opType: raw.opType,
    shapeId,
    shapeType,
    attrs,
  };
};

const shapeBounds = () => {
  const shapes = Object.values(useShapeStore.getState().shapes);
  if (shapes.length === 0) {
    return null;
  }

  return shapes.reduce(
    (bounds, shape) => {
      if (shape.type === 'pen' && shape.attrs.points && shape.attrs.points.length >= 2) {
        const xs = shape.attrs.points.filter((_, index) => index % 2 === 0).map((x) => x + shape.attrs.x);
        const ys = shape.attrs.points.filter((_, index) => index % 2 === 1).map((y) => y + shape.attrs.y);
        return {
          minX: Math.min(bounds.minX, ...xs),
          minY: Math.min(bounds.minY, ...ys),
          maxX: Math.max(bounds.maxX, ...xs),
          maxY: Math.max(bounds.maxY, ...ys),
        };
      }

      const width = shape.attrs.w ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 220);
      const height = shape.attrs.h ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 80);
      const left = shape.type === 'circle' ? shape.attrs.x - width / 2 : shape.attrs.x;
      const top = shape.type === 'circle' ? shape.attrs.y - height / 2 : shape.attrs.y;
      return {
        minX: Math.min(bounds.minX, left),
        minY: Math.min(bounds.minY, top),
        maxX: Math.max(bounds.maxX, left + width),
        maxY: Math.max(bounds.maxY, top + height),
      };
    },
    { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity }
  );
};

export function Room() {
  const { roomId = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [, setEvents] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(() => Date.now());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyPreview, setHistoryPreview] = useState<{ snapshotId: string; snapshotShapes: number; ops: number; at: number } | null>(null);
  const [chatMessages, setChatMessages] = useState<import('../components/MeetingBar').ChatMessage[]>([]);
  const [remoteEmoji, setRemoteEmoji] = useState<{ id: string; emoji: string } | null>(null);
  const [roomName, setRoomName] = useState('');
  const [roomWsUrl, setRoomWsUrl] = useState('');
  const [joinToken, setJoinToken] = useState('');
  const [lastRestoredOps, setLastRestoredOps] = useState(0);
  const [lastReplayedOps, setLastReplayedOps] = useState(0);
  const [lastFlushedOps, setLastFlushedOps] = useState(0);
  const [pendingOpsCount, setPendingOpsCount] = useState(0);
  const [reconnectAttempts, setReconnectAttempts] = useState(0);
  const [roomPassword, setRoomPassword] = useState(() => searchParams.get('password') ?? '');
  const [roomAccessState, setRoomAccessState] = useState<'checking' | 'ready' | 'password' | 'missing'>('checking');
  const [roomPasswordError, setRoomPasswordError] = useState<string | null>(null);
  const [roomVoiceEnabled, setRoomVoiceEnabled] = useState(false);
  const [roomPermissionMode, setRoomPermissionMode] = useState('edit');
  const [roomMemberRole, setRoomMemberRole] = useState('');
  const [members, setMembers] = useState<RoomMember[]>([]);
  const [memberUsername, setMemberUsername] = useState('');
  const [memberRole, setMemberRole] = useState<RoomMember['role']>('edit');
  const [memberError, setMemberError] = useState<string | null>(null);
  const [membersLoading, setMembersLoading] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState(() => ({
    width: typeof window === 'undefined' ? 960 : window.innerWidth,
    height: typeof window === 'undefined' ? 520 : Math.max(320, window.innerHeight - 86),
  }));
  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1, x: 0, y: 0 });
  const [previewPositions, setPreviewPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [penPreviews, setPenPreviews] = useState<Record<string, { points: number[]; stroke?: string; strokeWidth?: number }>>({});
  const [productQuery, setProductQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [phases, setPhases] = useState<MeetingPhase[]>(meetingPhases);
  const [activePhaseId, setActivePhaseId] = useState<MeetingPhaseId>('prepare');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [cacheStats, setCacheStats] = useState<CacheStatsResponse | null>(null);
  const [queueStats, setQueueStats] = useState<QueueStatsResponse | null>(null);
  const [historyAnchors, setHistoryAnchors] = useState<HistoryAnchors | null>(null);
  const [historyMode, setHistoryMode] = useState(false);
  const [undoCount, setUndoCount] = useState(0);
  const [redoCount, setRedoCount] = useState(0);
  const clipboardRef = useRef<ShapeOperation[]>([]);
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const historyBatchRef = useRef<HistoryEntry | null>(null);
  const historyReplayRef = useRef(false);
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const shellRef = useRef<HTMLElement | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const hlcRef = useRef<HybridLogicalClock | null>(null);
  const lastCursorSentAt = useRef(0);
  const lastCursorSentPointRef = useRef<{ x: number; y: number } | null>(null);
  const lastShapePreviewSentAt = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const restoringRef = useRef(false);
  const bufferedOpsRef = useRef<ShapeOperation[]>([]);
  const pendingOpsRef = useRef<ShapeOperation[]>([]);
  const remoteCursorBufferRef = useRef<Map<string, RemoteCursorUpdate>>(new Map());
  const remoteCursorFrameRef = useRef<number | null>(null);
  const previewPositionBufferRef = useRef<Record<string, { x: number; y: number }>>({});
  const penPreviewBufferRef = useRef<Record<string, PenPreviewState>>({});
  const previewRemovalBufferRef = useRef<Set<string>>(new Set());
  const previewFlushFrameRef = useRef<number | null>(null);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const restoreGenerationRef = useRef(0);
  const connectionGenerationRef = useRef(0);
  const setRoomId = useConnectionStore((state) => state.setRoomId);
  const setStatus = useConnectionStore((state) => state.setStatus);
  const setClient = useConnectionStore((state) => state.setClient);
  const status = useConnectionStore((state) => state.status);
  const wsClient = useConnectionStore((state) => state.wsClient);
  const userId = useUserStore((state) => state.userId);
  const authToken = useUserStore((state) => state.authToken);
  const username = useUserStore((state) => state.username);
  const displayName = useUserStore((state) => state.displayName);
  const color = useUserStore((state) => state.color);
  const setPeers = useUserStore((state) => state.setPeers);
  const addPeer = useUserStore((state) => state.addPeer);
  const removePeer = useUserStore((state) => state.removePeer);
  const updateCursors = useUserStore((state) => state.updateCursors);
  const remoteCount = useUserStore((state) => Object.keys(state.remotes).length);
  const remotes = useUserStore((state) => state.remotes);
  const applyOp = useShapeStore((state) => state.applyOp);
  const replaceWithSnapshot = useShapeStore((state) => state.replaceWithSnapshot);
  const shapeMap = useShapeStore((state) => state.shapes);
  const selectedId = useShapeStore((state) => state.selectedId);
  const selectedIds = useShapeStore((state) => state.selectedIds);
  const selectedShape = useMemo(() => selectedId ? shapeMap[selectedId] ?? null : null, [selectedId, shapeMap]);
  const selectedShapes = useMemo(
    () => selectedIds
      .map((shapeId) => shapeMap[shapeId])
      .filter((shape): shape is CanvasShape => Boolean(shape))
    ,
    [selectedIds, shapeMap]
  );
  const allShapes = useMemo(() => Object.values(shapeMap), [shapeMap]);
  const visibleShapeIds = useMemo(() => {
    const hasFilters = productQuery.trim() !== '' || statusFilter !== 'all' || tagFilter !== 'all';
    if (!hasFilters) {
      return null;
    }

    const query = productQuery.trim().toLowerCase();
    return new Set(allShapes
      .filter((shape) => {
        const matchesQuery = query === '' || shapeText(shape).includes(query);
        const matchesStatus = statusFilter === 'all' || shape.attrs.status === statusFilter;
        const matchesTag = tagFilter === 'all' || (shape.attrs.tags ?? []).includes(tagFilter);
        return matchesQuery && matchesStatus && matchesTag;
      })
      .map((shape) => shape.id));
  }, [allShapes, productQuery, statusFilter, tagFilter]);
  const initialRoomPassword = useMemo(() => searchParams.get('password') ?? '', [searchParams]);

  const flushRemoteCursors = useCallback(() => {
    const updates = [...remoteCursorBufferRef.current.values()];
    remoteCursorBufferRef.current.clear();
    remoteCursorFrameRef.current = null;
    updateCursors(updates);
  }, [updateCursors]);

  const queueRemoteCursor = useCallback((message: Extract<ServerMessage, { type: 'cursor' }>) => {
    remoteCursorBufferRef.current.set(message.userId, {
      userId: message.userId,
      x: message.x,
      y: message.y,
      displayName: message.displayName,
      color: message.color,
    });

    if (remoteCursorFrameRef.current === null) {
      remoteCursorFrameRef.current = window.requestAnimationFrame(flushRemoteCursors);
    }
  }, [flushRemoteCursors]);

  const flushRemotePreviews = useCallback(() => {
    const removedShapeIds = previewRemovalBufferRef.current;
    const positionUpdates = previewPositionBufferRef.current;
    const penUpdates = penPreviewBufferRef.current;
    previewRemovalBufferRef.current = new Set();
    previewPositionBufferRef.current = {};
    penPreviewBufferRef.current = {};
    previewFlushFrameRef.current = null;

    setPreviewPositions((current) => {
      let next = current;
      let changed = false;
      const ensureNext = () => {
        if (next === current) {
          next = { ...current };
        }
      };

      removedShapeIds.forEach((shapeId) => {
        if (next[shapeId]) {
          ensureNext();
          delete next[shapeId];
          changed = true;
        }
      });

      Object.entries(positionUpdates).forEach(([shapeId, position]) => {
        const existing = next[shapeId];
        if (existing?.x === position.x && existing.y === position.y) {
          return;
        }

        ensureNext();
        next[shapeId] = position;
        changed = true;
      });

      return changed ? next : current;
    });

    setPenPreviews((current) => {
      let next = current;
      let changed = false;
      const ensureNext = () => {
        if (next === current) {
          next = { ...current };
        }
      };

      removedShapeIds.forEach((shapeId) => {
        if (next[shapeId]) {
          ensureNext();
          delete next[shapeId];
          changed = true;
        }
      });

      Object.entries(penUpdates).forEach(([shapeId, preview]) => {
        ensureNext();
        next[shapeId] = preview;
        changed = true;
      });

      return changed ? next : current;
    });
  }, []);

  const scheduleRemotePreviewFlush = useCallback(() => {
    if (previewFlushFrameRef.current === null) {
      previewFlushFrameRef.current = window.requestAnimationFrame(flushRemotePreviews);
    }
  }, [flushRemotePreviews]);

  const clearRemotePreview = useCallback((shapeId: string) => {
    delete previewPositionBufferRef.current[shapeId];
    delete penPreviewBufferRef.current[shapeId];
    previewRemovalBufferRef.current.add(shapeId);
    scheduleRemotePreviewFlush();
  }, [scheduleRemotePreviewFlush]);

  const queueRemoteShapePreview = useCallback((message: Extract<ServerMessage, { type: 'shape-preview' }>) => {
    const { points, stroke, strokeWidth, x, y } = message.op.attrs ?? {};
    const shapeId = message.op.shapeId;
    previewRemovalBufferRef.current.delete(shapeId);

    if (message.op.shapeType === 'pen' && Array.isArray(points) && points.length >= 4) {
      penPreviewBufferRef.current[shapeId] = {
        points,
        stroke: typeof stroke === 'string' ? stroke : undefined,
        strokeWidth: typeof strokeWidth === 'number' ? strokeWidth : undefined,
      };
      delete previewPositionBufferRef.current[shapeId];
      scheduleRemotePreviewFlush();
      return;
    }

    if (typeof x === 'number' && typeof y === 'number') {
      previewPositionBufferRef.current[shapeId] = { x, y };
      delete penPreviewBufferRef.current[shapeId];
      scheduleRemotePreviewFlush();
    }
  }, [scheduleRemotePreviewFlush]);

  const resetRemoteTransientBuffers = useCallback(() => {
    if (remoteCursorFrameRef.current !== null) {
      window.cancelAnimationFrame(remoteCursorFrameRef.current);
      remoteCursorFrameRef.current = null;
    }
    if (previewFlushFrameRef.current !== null) {
      window.cancelAnimationFrame(previewFlushFrameRef.current);
      previewFlushFrameRef.current = null;
    }
    remoteCursorBufferRef.current.clear();
    previewPositionBufferRef.current = {};
    penPreviewBufferRef.current = {};
    previewRemovalBufferRef.current = new Set();
  }, []);

  useEffect(() => resetRemoteTransientBuffers, [resetRemoteTransientBuffers]);

  useEffect(() => {
    if (!import.meta.env.DEV) {
      return undefined;
    }

    window.__cocanvasPerfSeed = (count: number) => {
      const safeCount = Math.max(1, Math.min(10000, Math.floor(count)));
      const snapshot = Object.fromEntries(
        Array.from({ length: safeCount }, (_, index) => {
          const columns = Math.ceil(Math.sqrt(safeCount));
          const x = 80 + (index % columns) * 172;
          const y = 90 + Math.floor(index / columns) * 122;
          const shapeId = `perf-node-${index}`;
          return [
            shapeId,
            {
              shapeType: 'rect',
              x,
              y,
              w: 140,
              h: 88,
              text: `N${index + 1}`,
              fill: index === 0 ? '#f59f00' : '#e0f2fe',
              stroke: index === 0 ? '#92400e' : '#0369a1',
              strokeWidth: 2,
              textColor: '#0f172a',
              fontSize: 15,
              cornerRadius: 0,
              zIndex: index,
            },
          ];
        })
      );

      useShapeStore.getState().replaceWithSnapshot(snapshot);
      useShapeStore.getState().setSelectedIds(['perf-node-0']);
      setPreviewPositions({});
      setPenPreviews({});
      setActiveGroupId(null);
      setEvents((current) => [`perf seed: ${safeCount} local nodes`, ...current].slice(0, 5));
      return { count: safeCount, firstId: 'perf-node-0' };
    };

    return () => {
      delete window.__cocanvasPerfSeed;
    };
  }, []);

  const applyHistoryState = useCallback((history: HistoryResponse) => {
    const snapshot = parseSnapshotPayload(history.snapshot.payload);
    replaceWithSnapshot(snapshot);
    history.ops.forEach((op) => {
      applyOp({
        ...(JSON.parse(op.payload) as ShapeOperation),
        hlc: op.hlc,
        writerId: op.userId,
      });
    });

    return history.ops.length;
  }, [applyOp, replaceWithSnapshot]);

  const summarizeHistoryState = useCallback((history: HistoryResponse, at: number) => {
    const snapshot = parseSnapshotPayload(history.snapshot.payload);
    return {
      snapshotId: history.snapshot.snapshotId,
      snapshotShapes: Object.keys(snapshot).length,
      ops: history.ops.length,
      at,
    };
  }, []);

  const verifyRoomAccess = useCallback(async (password?: string) => {
    if (!roomId) {
      setRoomAccessState('missing');
      return null;
    }

    setRoomAccessState('checking');
    setRoomPasswordError(null);
    const room = await getRoom(roomId, password || undefined, authToken || undefined);
    if (!room.exists) {
      setRoomAccessState('missing');
      return room;
    }

    setRoomName(room.name);
    setRoomVoiceEnabled(room.voiceEnabled);
    setRoomPermissionMode(room.permissionMode || 'edit');
    setRoomMemberRole(room.memberRole || '');
    if (!room.authorized) {
      setRoomWsUrl('');
      setJoinToken('');
      setRoomAccessState('password');
      return room;
    }

    setRoomWsUrl(room.wsUrl);
    setJoinToken(room.joinToken);
    setRoomAccessState('ready');
    return room;
  }, [authToken, roomId]);

  const loadMembers = useCallback(async () => {
    if (!roomId) {
      return;
    }

    setMembersLoading(true);
    setMemberError(null);
    try {
      setMembers(await listRoomMembers(roomId));
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : '加载成员失败');
    } finally {
      setMembersLoading(false);
    }
  }, [roomId]);

  const refreshAccessAndMembers = useCallback(async () => {
    await verifyRoomAccess(roomPassword || undefined);
    await loadMembers();
  }, [loadMembers, roomPassword, verifyRoomAccess]);

  // 用 ref 持有最新回调，供 WS 事件调用而不污染连接 effect 的依赖
  const loadMembersRef = useRef(loadMembers);
  useEffect(() => {
    loadMembersRef.current = loadMembers;
  }, [loadMembers]);
  const refreshAccessAndMembersRef = useRef(refreshAccessAndMembers);
  useEffect(() => {
    refreshAccessAndMembersRef.current = refreshAccessAndMembers;
  }, [refreshAccessAndMembers]);

  const handleClaimOwner = useCallback(async () => {
    if (!authToken) {
      setMemberError('请先登录账号再认领房间');
      return;
    }
    setMemberError(null);
    try {
      await claimRoomOwner(roomId, authToken);
      await refreshAccessAndMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : '认领房间失败');
    }
  }, [authToken, refreshAccessAndMembers, roomId]);

  const handleSaveMember = useCallback(async () => {
    if (!authToken) {
      setMemberError('请先登录账号再管理成员');
      return;
    }
    if (!memberUsername.trim()) {
      setMemberError('请输入对方用户名');
      return;
    }
    setMemberError(null);
    try {
      await upsertRoomMember(roomId, { username: memberUsername, role: memberRole }, authToken);
      setMemberUsername('');
      await refreshAccessAndMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : '保存成员失败');
    }
  }, [authToken, memberRole, memberUsername, refreshAccessAndMembers, roomId]);

  const handleChangeMemberRole = useCallback(async (member: RoomMember, role: RoomMember['role']) => {
    if (!authToken) {
      setMemberError('请先登录账号再管理成员');
      return;
    }
    setMemberError(null);
    try {
      await upsertRoomMember(roomId, { userId: member.userId, role }, authToken);
      await refreshAccessAndMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : '更新成员失败');
    }
  }, [authToken, refreshAccessAndMembers, roomId]);

  const handleRemoveMember = useCallback(async (member: RoomMember) => {
    if (!authToken) {
      setMemberError('请先登录账号再管理成员');
      return;
    }
    setMemberError(null);
    try {
      await removeRoomMember(roomId, member.userId, authToken);
      await refreshAccessAndMembers();
    } catch (err) {
      setMemberError(err instanceof Error ? err.message : '移除成员失败');
    }
  }, [authToken, refreshAccessAndMembers, roomId]);

  const restoreLatestState = useCallback(async () => {
    const history = await getRoomHistory(roomId);
    return applyHistoryState(history);
  }, [applyHistoryState, roomId]);

  const replayBufferedOps = useCallback(() => {
    const bufferedOps = bufferedOpsRef.current;
    bufferedOpsRef.current = [];
    bufferedOps.forEach(applyOp);
    return bufferedOps.length;
  }, [applyOp]);

  const applyRemoteOp = useCallback((message: Extract<ServerMessage, { type: 'op' }>) => {
    const mergedHlc = hlcRef.current?.update(message.hlc) ?? message.hlc;
    const op = { ...message.op, hlc: mergedHlc, writerId: message.userId };
    clearRemotePreview(op.shapeId);

    if (restoringRef.current) {
      bufferedOpsRef.current.push(op);
      return;
    }

    applyOp(op);
  }, [applyOp, clearRemotePreview]);

  if (!hlcRef.current) {
    hlcRef.current = new HybridLogicalClock(userId);
  }

  const stampOp = useCallback((op: ShapeOperation): ShapeOperation => {
    const hlc = op.hlc ?? hlcRef.current?.now() ?? `${Date.now()}.0.${userId}`;
    return { ...op, opId: op.opId ?? msgId(), hlc, writerId: userId };
  }, [userId]);

  const pendingOpsStorageKey = useMemo(() => (
    roomId && userId ? `${pendingOpsStoragePrefix}${roomId}:${userId}` : ''
  ), [roomId, userId]);

  const persistPendingOps = useCallback((ops: ShapeOperation[]) => {
    setPendingOpsCount(ops.length);
    if (!pendingOpsStorageKey) {
      return;
    }

    if (ops.length === 0) {
      window.localStorage.removeItem(pendingOpsStorageKey);
      return;
    }

    window.localStorage.setItem(pendingOpsStorageKey, JSON.stringify(ops));
  }, [pendingOpsStorageKey]);

  useEffect(() => {
    if (!pendingOpsStorageKey) {
      pendingOpsRef.current = [];
      return;
    }

    try {
      const stored = window.localStorage.getItem(pendingOpsStorageKey);
      pendingOpsRef.current = stored ? JSON.parse(stored) as ShapeOperation[] : [];
      setPendingOpsCount(pendingOpsRef.current.length);
      if (pendingOpsRef.current.length > 0) {
        setEvents((current) => [`restored pending ops: ${pendingOpsRef.current.length}`, ...current].slice(0, 5));
      }
    } catch {
      pendingOpsRef.current = [];
      setPendingOpsCount(0);
      window.localStorage.removeItem(pendingOpsStorageKey);
    }
  }, [pendingOpsStorageKey]);

  const sendStampedOp = useCallback((client: WSClient, op: ShapeOperation) => {
    client.sendJson({
      type: 'op',
      msgId: msgId(),
      roomId,
      userId,
      hlc: op.hlc ?? '',
      op,
    });
  }, [roomId, userId]);

  const buildInverseOp = useCallback((op: ShapeOperation): ShapeOperation | null => {
    const existing = useShapeStore.getState().shapes[op.shapeId];

    if (op.opType === 'create') {
      return {
        opType: 'delete',
        shapeId: op.shapeId,
        shapeType: op.shapeType,
      };
    }

    if (op.opType === 'delete') {
      if (!existing) {
        return null;
      }

      return {
        opType: 'create',
        shapeId: existing.id,
        shapeType: existing.type,
        attrs: cloneShapeAttrs(existing.attrs),
      };
    }

    if (!existing) {
      return null;
    }

    const previousAttrs = Object.fromEntries(
      Object.keys(op.attrs ?? {}).map((key) => [
        key,
        cloneShapeAttrs(existing.attrs)[key as keyof ShapeAttrs],
      ])
    ) as ShapeAttrs;

    return {
      opType: 'update',
      shapeId: op.shapeId,
      shapeType: op.shapeType,
      attrs: previousAttrs,
    };
  }, []);

  const recordHistoryOp = useCallback((redo: ShapeOperation, undo: ShapeOperation | null) => {
    if (!undo || historyReplayRef.current) {
      return;
    }

    const entry = {
      undo: [cloneOpForHistory(undo)],
      redo: [cloneOpForHistory(redo)],
    };

    if (historyBatchRef.current) {
      historyBatchRef.current.undo.unshift(...entry.undo);
      historyBatchRef.current.redo.push(...entry.redo);
      return;
    }

    undoStackRef.current.push(entry);
    redoStackRef.current = [];
    setUndoCount(undoStackRef.current.length);
    setRedoCount(0);
  }, []);

  const runHistoryBatch = useCallback((fn: () => void) => {
    historyBatchRef.current = { undo: [], redo: [] };
    fn();
    const entry = historyBatchRef.current;
    historyBatchRef.current = null;
    if (entry && entry.undo.length > 0 && entry.redo.length > 0 && !historyReplayRef.current) {
      undoStackRef.current.push(entry);
      redoStackRef.current = [];
      setUndoCount(undoStackRef.current.length);
      setRedoCount(0);
    }
  }, []);

  const flushPendingOps = useCallback((client: WSClient) => {
    const pendingOps = pendingOpsRef.current;
    pendingOps.forEach((op) => {
      applyOp(op);
      sendStampedOp(client, op);
    });
    return pendingOps.length;
  }, [applyOp, sendStampedOp]);

  const acknowledgePendingOp = useCallback((opId: string | undefined, hlc: string) => {
    if (!opId) {
      return;
    }

    const acknowledged = pendingOpsRef.current.find((op) => op.opId === opId);
    if (acknowledged) {
      hlcRef.current?.update(hlc);
      applyOp({ ...acknowledged, hlc, writerId: userId });
    }

    const next = pendingOpsRef.current.filter((op) => op.opId !== opId);
    if (next.length === pendingOpsRef.current.length) {
      return;
    }

    pendingOpsRef.current = next;
    persistPendingOps(next);
  }, [applyOp, persistPendingOps, userId]);

  const queuePendingOp = useCallback((op: ShapeOperation) => {
    if (op.opType !== 'update') {
      pendingOpsRef.current.push(op);
      persistPendingOps(pendingOpsRef.current);
      return pendingOpsRef.current.length;
    }

    const sameShapeUpdateIndex = pendingOpsRef.current.findIndex((pending) => (
      pending.opType === 'update' &&
      pending.shapeId === op.shapeId &&
      pending.shapeType === op.shapeType
    ));

    if (sameShapeUpdateIndex >= 0) {
      pendingOpsRef.current[sameShapeUpdateIndex] = {
        ...pendingOpsRef.current[sameShapeUpdateIndex],
        ...op,
        attrs: {
          ...pendingOpsRef.current[sameShapeUpdateIndex].attrs,
          ...op.attrs,
        },
      };
      persistPendingOps(pendingOpsRef.current);
      return pendingOpsRef.current.length;
    }

    pendingOpsRef.current.push(op);
    persistPendingOps(pendingOpsRef.current);
    return pendingOpsRef.current.length;
  }, [persistPendingOps]);

  const sendShapeOp = useCallback((op: ShapeOperation) => {
    if (roomPermissionMode === 'view' || (roomPermissionMode === 'comment' && op.shapeType !== 'comment')) {
      setEvents((current) => ['permission denied locally', ...current].slice(0, 5));
      return;
    }

    const inverseOp = buildInverseOp(op);
    recordHistoryOp(op, inverseOp);
    const stampedOp = stampOp(op);
    applyOp(stampedOp);
    const pendingCount = queuePendingOp(stampedOp);
    if (status !== 'connected' || !wsClient) {
      setEvents((current) => [`queued offline op: ${pendingCount}`, ...current].slice(0, 5));
      return;
    }

    sendStampedOp(wsClient, stampedOp);
  }, [applyOp, buildInverseOp, queuePendingOp, recordHistoryOp, roomPermissionMode, sendStampedOp, stampOp, status, wsClient]);

  const sendHistoryOps = useCallback((ops: ShapeOperation[]) => {
    historyReplayRef.current = true;
    ops.forEach(sendShapeOp);
    historyReplayRef.current = false;
  }, [sendShapeOp]);

  const undoLastAction = useCallback(() => {
    const entry = undoStackRef.current.pop();
    if (!entry) {
      setEvents((current) => ['nothing to undo', ...current].slice(0, 5));
      return;
    }

    sendHistoryOps(entry.undo);
    redoStackRef.current.push(entry);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setEvents((current) => [`undo ${entry.undo.length} op(s)`, ...current].slice(0, 5));
  }, [sendHistoryOps]);

  const redoLastAction = useCallback(() => {
    const entry = redoStackRef.current.pop();
    if (!entry) {
      setEvents((current) => ['nothing to redo', ...current].slice(0, 5));
      return;
    }

    sendHistoryOps(entry.redo);
    undoStackRef.current.push(entry);
    setUndoCount(undoStackRef.current.length);
    setRedoCount(redoStackRef.current.length);
    setEvents((current) => [`redo ${entry.redo.length} op(s)`, ...current].slice(0, 5));
  }, [sendHistoryOps]);

  const sendShapePreview = useCallback((op: ShapeOperation) => {
    if (status !== 'connected' || !wsClient) {
      return;
    }

    wsClient.sendJson({
      type: 'shape-preview',
      msgId: msgId(),
      roomId,
      userId,
      op,
    });
  }, [roomId, status, userId, wsClient]);

  const fitViewportToContent = useCallback(() => {
    const bounds = shapeBounds();
    if (!bounds) {
      setViewport({ scale: 1, x: 0, y: 0 });
      return;
    }

    const padding = 160;
    const contentWidth = Math.max(1, bounds.maxX - bounds.minX);
    const contentHeight = Math.max(1, bounds.maxY - bounds.minY);
    const nextScale = Math.min(1.2, Math.max(0.35, Math.min(
      stageSize.width / (contentWidth + padding),
      stageSize.height / (contentHeight + padding)
    )));

    setViewport({
      scale: nextScale,
      x: stageSize.width / 2 - ((bounds.minX + bounds.maxX) / 2) * nextScale,
      y: stageSize.height / 2 - ((bounds.minY + bounds.maxY) / 2) * nextScale,
    });
  }, [stageSize.height, stageSize.width]);

  useEffect(() => {
    let active = true;
    verifyRoomAccess(initialRoomPassword || undefined)
      .catch((err) => {
        if (active) {
          setRoomAccessState('missing');
          setEvents((current) => [`room check failed: ${err instanceof Error ? err.message : 'unknown'}`, ...current].slice(0, 5));
        }
      });

    return () => {
      active = false;
    };
  }, [initialRoomPassword, roomId, verifyRoomAccess]);

  useEffect(() => {
    if (roomAccessState !== 'ready') {
      return;
    }
    void loadMembers();
  }, [loadMembers, roomAccessState]);

  useEffect(() => {
    if (!roomId || roomAccessState !== 'ready' || !roomWsUrl || !authToken) {
      return;
    }

    let active = true;
    let client: WSClient | null = null;
    let reconnectTimer: number | undefined;
    let cleanupSubscriptions: (() => void) | undefined;

    const scheduleReconnect = () => {
      if (!active) {
        return;
      }

      const attempt = reconnectAttemptRef.current;
      const delay = reconnectDelays[Math.min(attempt, reconnectDelays.length - 1)];
      reconnectAttemptRef.current = attempt + 1;
      setReconnectAttempts(reconnectAttemptRef.current);
      setEvents((current) => [`reconnect in ${Math.round(delay / 1000)}s`, ...current].slice(0, 5));
      reconnectTimer = window.setTimeout(() => {
        cleanupSubscriptions?.();
        client?.close();
        void connect();
      }, delay);
    };

    const connect = async (): Promise<void> => {
      const connectionGeneration = connectionGenerationRef.current + 1;
      connectionGenerationRef.current = connectionGeneration;
      setRoomId(roomId);
      if (!active || connectionGenerationRef.current !== connectionGeneration) {
        return;
      }

      const url = resolveWsUrl(roomWsUrl);
      client = new WSClient(url);
      setClient(client);

      const unsubscribeStatus = client.onStatusChange((nextStatus) => {
        setStatus(nextStatus);
        if (nextStatus === 'connected') {
          const connectedClient = client;
          const restoreGeneration = restoreGenerationRef.current + 1;
          restoreGenerationRef.current = restoreGeneration;
          reconnectAttemptRef.current = 0;
          setReconnectAttempts(0);
          restoringRef.current = true;
          bufferedOpsRef.current = [];
          connectedClient?.sendJson({
            type: 'join',
            msgId: msgId(),
            roomId,
            userId,
            displayName,
            color,
            joinToken,
          });

          void restoreLatestState()
            .then((restoredOps) => {
              if (
                !active ||
                client !== connectedClient ||
                connectedClient?.getStatus() !== 'connected' ||
                connectionGenerationRef.current !== connectionGeneration ||
                restoreGenerationRef.current !== restoreGeneration
              ) {
                return;
              }

              const replayedOps = replayBufferedOps();
              const flushedOps = flushPendingOps(connectedClient);
              setLastRestoredOps(restoredOps);
              setLastReplayedOps(replayedOps);
              setLastFlushedOps(flushedOps);
              window.requestAnimationFrame(fitViewportToContent);
              setEvents((current) => [
                `state restored: ${restoredOps} ops, replayed ${replayedOps}, flushed ${flushedOps}`,
                ...current,
              ].slice(0, 5));
            })
            .catch((err) => {
              if (
                !active ||
                client !== connectedClient ||
                connectedClient?.getStatus() !== 'connected' ||
                connectionGenerationRef.current !== connectionGeneration ||
                restoreGenerationRef.current !== restoreGeneration
              ) {
                return;
              }

              const replayedOps = replayBufferedOps();
              const flushedOps = flushPendingOps(connectedClient);
              setLastRestoredOps(0);
              setLastReplayedOps(replayedOps);
              setLastFlushedOps(flushedOps);
              window.requestAnimationFrame(fitViewportToContent);
              setEvents((current) => [
                `restore failed: ${err instanceof Error ? err.message : 'unknown'}, replayed ${replayedOps}, flushed ${flushedOps}`,
                ...current,
              ].slice(0, 5));
            })
            .finally(() => {
              if (restoreGenerationRef.current === restoreGeneration) {
                restoringRef.current = false;
              }
            });
        }

        if (nextStatus === 'closed' || nextStatus === 'error') {
          scheduleReconnect();
        }
      });

      const unsubscribeMessages = client.onMessage((raw) => {
        const message = JSON.parse(raw) as ServerMessage;
        if (message.type === 'joined') {
          setPeers(message.peers);
          setEvents((current) => [`joined ${message.roomId}`, ...current].slice(0, 5));
          return;
        }

        if (message.type === 'peer-joined') {
          addPeer(message);
          setEvents((current) => [`${message.displayName} joined`, ...current].slice(0, 5));
          // 新加入者进房时已按房间默认权限自动登记为成员，刷新成员列表让 owner 立即看到
          void loadMembersRef.current?.();
          return;
        }

        if (message.type === 'peer-left') {
          removePeer(message.userId);
          setEvents((current) => [`${message.userId.slice(0, 8)} left`, ...current].slice(0, 5));
          return;
        }

        if (message.type === 'room-members') {
          // 成员/角色变化：刷新自身权限、角色与成员列表（重取 join token，使权限即时生效）
          void refreshAccessAndMembersRef.current?.();
          return;
        }

        if (message.type === 'cursor') {
          queueRemoteCursor(message);
          return;
        }

        if (message.type === 'op') {
          applyRemoteOp(message);
          return;
        }

        if (message.type === 'op-ack') {
          acknowledgePendingOp(message.opId, message.hlc);
          return;
        }

        if (message.type === 'shape-preview') {
          queueRemoteShapePreview(message);
          return;
        }

        if (message.type === 'room-chat') {
          setChatMessages((prev) => [
            ...prev,
            { id: `${message.userId}-${message.timestamp}`, userId: message.userId, displayName: message.displayName, color: message.color, text: message.text, timestamp: message.timestamp },
          ]);
          return;
        }

        if (message.type === 'room-emoji') {
          setRemoteEmoji({ id: `${message.userId}-${Date.now()}`, emoji: message.emoji });
          return;
        }

        if (message.type === 'room-phase') {
          setActivePhaseId(message.phaseId as MeetingPhaseId);
          return;
        }

        if (message.type === 'room-phases') {
          setPhases(message.phases as MeetingPhase[]);
          // If active phase was removed by the sender, fall back to first
          setActivePhaseId((current) => {
            const exists = message.phases.some((p) => p.id === current);
            return exists ? current : (message.phases[0]?.id ?? current) as MeetingPhaseId;
          });
          return;
        }

        if (message.type === 'error') {
          setEvents((current) => [`error: ${message.message}`, ...current].slice(0, 5));
          if (message.code === 'op_persist_failed') {
            client?.close();
          }
        }
      });

      client.connect();

      cleanupSubscriptions = () => {
        unsubscribeStatus();
        unsubscribeMessages();
      };
    };

    connect()
      .catch((err) => {
        setStatus('error');
        setEvents((current) => [`connect failed: ${err instanceof Error ? err.message : 'unknown'}`, ...current].slice(0, 5));
        scheduleReconnect();
      });

    return () => {
      active = false;
      if (reconnectTimer) {
        window.clearTimeout(reconnectTimer);
      }
      cleanupSubscriptions?.();
      client?.close();
      connectionGenerationRef.current += 1;
      resetRemoteTransientBuffers();
      setClient(null);
      setRoomId(null);
    };
  }, [acknowledgePendingOp, addPeer, applyOp, applyRemoteOp, authToken, color, displayName, fitViewportToContent, flushPendingOps, joinToken, queueRemoteCursor, queueRemoteShapePreview, removePeer, replayBufferedOps, resetRemoteTransientBuffers, restoreLatestState, roomAccessState, roomId, roomWsUrl, setClient, setPeers, setRoomId, setStatus, userId]);

  useEffect(() => {
    if (roomAccessState !== 'ready') {
      return undefined;
    }

    const element = stageRef.current;
    if (!element) {
      return undefined;
    }

    const updateStageSize = () => {
      const topbarHeight = Math.ceil(topbarRef.current?.getBoundingClientRect().height ?? 86);
      // 成员面板已改为左下角浮层，不再占据画布顶部空间
      const boardTop = topbarHeight;
      const nextWidth = Math.ceil(window.innerWidth);
      const nextHeight = Math.max(1, window.innerHeight - boardTop);
      if (nextWidth < 2 || nextHeight < 2) {
        return;
      }
      element.style.setProperty('--board-top', `${boardTop}px`);
      shellRef.current?.style.setProperty('--board-top', `${boardTop}px`);
      setStageSize({
        width: nextWidth,
        height: nextHeight,
      });
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(element);
    if (topbarRef.current) {
      observer.observe(topbarRef.current);
    }
    window.addEventListener('resize', updateStageSize);
    const frameId = window.requestAnimationFrame(updateStageSize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', updateStageSize);
      window.cancelAnimationFrame(frameId);
    };
  }, [roomAccessState]);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = toRelativePoint(event);
    const canvasPoint = screenToCanvasPoint(point);
    lastCanvasPointRef.current = canvasPoint;
    const now = Date.now();
    if (now - lastCursorSentAt.current < cursorIntervalMs || status !== 'connected') {
      return;
    }

    const lastSentPoint = lastCursorSentPointRef.current;
    if (lastSentPoint) {
      const screenDistance = Math.hypot(
        (canvasPoint.x - lastSentPoint.x) * viewport.scale,
        (canvasPoint.y - lastSentPoint.y) * viewport.scale
      );
      if (screenDistance < cursorMinScreenDistance && now - lastCursorSentAt.current < cursorTinyMoveRefreshMs) {
        return;
      }
    }

    lastCursorSentAt.current = now;
    lastCursorSentPointRef.current = canvasPoint;
    wsClient?.sendJson({
      type: 'cursor',
      msgId: msgId(),
      roomId,
      userId,
      x: canvasPoint.x,
      y: canvasPoint.y,
    });
  };

  const handleToolSelect = (tool: ToolMode) => {
    setActiveTool(tool);
  };

  const handlePasswordSubmit = async () => {
    try {
      const room = await verifyRoomAccess(roomPassword);
      if (room && !room.authorized) {
        setRoomPasswordError('密码不正确，请重新输入。');
        setRoomAccessState('password');
        return;
      }
      if (room?.authorized && roomPassword) {
        setSearchParams({ password: roomPassword });
      }
    } catch (err) {
      setRoomPasswordError('验证失败，请稍后再试。');
      setEvents((current) => [`password check failed: ${err instanceof Error ? err.message : 'unknown'}`, ...current].slice(0, 5));
      setRoomAccessState('password');
    }
  };

  const toggleMicrophone = async () => {
    setMicError(null);
    if (micEnabled) {
      localAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
      localAudioStreamRef.current = null;
      setMicEnabled(false);
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError('当前浏览器不支持麦克风权限');
      return;
    }

    try {
      localAudioStreamRef.current = await navigator.mediaDevices.getUserMedia({ audio: true });
      setMicEnabled(true);
    } catch (err) {
      setMicError(err instanceof Error ? err.message : '无法开启麦克风');
    }
  };

  useEffect(() => () => {
    localAudioStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  const handleDeleteSelected = useCallback(() => {
    const shapesToDelete = selectedShapes.length > 0 ? selectedShapes : selectedShape ? [selectedShape] : [];
    if (shapesToDelete.length === 0) {
      return;
    }

    runHistoryBatch(() => {
      shapesToDelete.forEach((shape) => {
        sendShapeOp({
          opType: 'delete',
          shapeId: shape.id,
          shapeType: shape.type,
        });
      });
    });
    setActiveGroupId(null);
  }, [runHistoryBatch, selectedShape, selectedShapes, sendShapeOp]);

  const getGroupMemberIds = useCallback((groupId: string) => (
    Object.values(shapeMap)
      .filter((shape) => shape.attrs.groupId === groupId)
      .map((shape) => shape.id)
  ), [shapeMap]);

  const setSelectionWithGroups = useCallback((shapeIds: string[], options?: SelectionChangeOptions) => {
    const store = useShapeStore.getState();
    const currentIds = store.selectedIds;
    const source = options?.source ?? 'shape';

    if (shapeIds.length === 0) {
      setActiveGroupId(null);
      store.setSelectedIds([]);
      return [];
    }

    if (options?.additive) {
      setActiveGroupId(null);
      const nextIds = [...currentIds];
      shapeIds.forEach((shapeId) => {
        const groupId = shapeMap[shapeId]?.attrs.groupId;
        const targetIds = groupId && currentIds.includes(shapeId)
          ? [shapeId]
          : groupId
            ? getGroupMemberIds(groupId)
            : [shapeId];

        targetIds.forEach((targetId) => {
          const existingIndex = nextIds.indexOf(targetId);
          if (existingIndex >= 0) {
            nextIds.splice(existingIndex, 1);
          } else {
            nextIds.push(targetId);
          }
        });
      });
      store.setSelectedIds(nextIds);
      return nextIds;
    }

    if (source === 'shape' || source === 'drag' || source === 'context' || source === 'resize') {
      const shape = shapeMap[shapeIds[0]];
      const groupId = shape?.attrs.groupId ?? null;

      if (groupId) {
        const groupMemberIds = getGroupMemberIds(groupId);
        const groupAlreadySelected = groupMemberIds.length > 1 && groupMemberIds.every((shapeId) => currentIds.includes(shapeId));

        if (source === 'shape' && (activeGroupId === groupId || groupAlreadySelected)) {
          setActiveGroupId(groupId);
          store.setSelectedIds([shapeIds[0]]);
          return [shapeIds[0]];
        }

        setActiveGroupId(source === 'context' ? null : groupId);
        store.setSelectedIds(groupMemberIds);
        return groupMemberIds;
      }
    }

    if (source === 'marquee') {
      const ids = new Set(shapeIds);
      shapeIds.forEach((shapeId) => {
        const groupId = shapeMap[shapeId]?.attrs.groupId;
        if (!groupId) {
          return;
        }

        getGroupMemberIds(groupId).forEach((memberId) => ids.add(memberId));
      });
      const nextIds = [...ids];
      setActiveGroupId(null);
      store.setSelectedIds(nextIds);
      return nextIds;
    }

    setActiveGroupId(null);
    store.setSelectedIds(shapeIds);
    return shapeIds;
  }, [activeGroupId, getGroupMemberIds, shapeMap]);

  const handleShapeCommit = (op: ShapeOperation) => {
    if (roomPermissionMode === 'view' || (roomPermissionMode === 'comment' && op.shapeType !== 'comment')) {
      setEvents((current) => ['permission denied locally', ...current].slice(0, 5));
      return;
    }

    const stampedOp = stampOp(op);
    clearRemotePreview(stampedOp.shapeId);
    applyOp(stampedOp);
    const pendingCount = queuePendingOp(stampedOp);

    if (status !== 'connected' || !wsClient) {
      setEvents((current) => [`queued offline op: ${pendingCount}`, ...current].slice(0, 5));
      return;
    }

    sendStampedOp(wsClient, stampedOp);
  };

  const handleShapePreview = (op: ShapeOperation) => {
    const now = Date.now();
    if (now - lastShapePreviewSentAt.current < shapePreviewIntervalMs) {
      return;
    }

    lastShapePreviewSentAt.current = now;
    sendShapePreview(op);
  };

  const viewportCenter = useCallback(() => ({
    x: Math.round((stageSize.width / 2 - viewport.x) / viewport.scale),
    y: Math.round((stageSize.height / 2 - viewport.y) / viewport.scale),
  }), [stageSize.height, stageSize.width, viewport.scale, viewport.x, viewport.y]);

  const handleCreateCard = () => {
    const center = viewportCenter();
    sendShapeOp(createCardOp(center.x - 130, center.y - 84));
    setActiveTool('select');
  };

  const screenToCanvasPoint = (point: { x: number; y: number }) => ({
    x: Math.round((point.x - viewport.x) / viewport.scale),
    y: Math.round((point.y - viewport.y) / viewport.scale),
  });

  const handleToolDrop = (event: React.DragEvent<HTMLElement>) => {
    const tool = event.dataTransfer.getData('application/x-cocanvas-tool') as ToolMode;
    if (!isDraggableCreateTool(tool)) {
      return;
    }

    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const point = screenToCanvasPoint({
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });

    const op = tool === 'card'
      ? createCardOp(point.x - 130, point.y - 84)
      : createShapeOp(tool, point.x, point.y);

    sendShapeOp(op);
    setActiveTool('select');
  };

  const shapesForSelection = useCallback(() => (
    selectedShapes.length > 0 ? selectedShapes : selectedShape ? [selectedShape] : []
  ), [selectedShape, selectedShapes]);

  const insertTemplateAt = useCallback((templateId: ProductTemplateId, point: { x: number; y: number }) => {
    const ops = createTemplateOps(templateId, point.x, point.y);
    runHistoryBatch(() => {
      ops.forEach(sendShapeOp);
    });
    window.requestAnimationFrame(fitViewportToContent);
    setEvents((current) => [`inserted template: ${templateId}`, ...current].slice(0, 5));
  }, [fitViewportToContent, runHistoryBatch, sendShapeOp]);

  const handleTemplateInsert = (templateId: ProductTemplateId) => {
    const center = viewportCenter();
    insertTemplateAt(templateId, { x: center.x - 420, y: center.y - 220 });
  };

  const activeMeetingPhase = phases.find((phase) => phase.id === activePhaseId) ?? phases[0] ?? meetingPhases[0];

  const handlePhaseChange = (phaseId: MeetingPhaseId) => {
    setActivePhaseId(phaseId);
    if (roomId) {
      wsClient?.sendJson({ type: 'room-phase', msgId: `${userId}-${Date.now()}`, roomId, userId, phaseId });
    }
  };

  const handlePhaseStep = (direction: 1 | -1) => {
    const currentIndex = phases.findIndex((phase) => phase.id === activePhaseId);
    const nextIndex = Math.min(phases.length - 1, Math.max(0, currentIndex + direction));
    handlePhaseChange(phases[nextIndex].id);
  };

  const handleInsertPhaseTemplate = () => {
    handleTemplateInsert(activeMeetingPhase.templateId);
  };

  const broadcastPhases = useCallback((nextPhases: MeetingPhase[]) => {
    if (!roomId) return;
    wsClient?.sendJson({
      type: 'room-phases',
      msgId: `${userId}-${Date.now()}`,
      roomId,
      userId,
      phases: nextPhases,
    });
  }, [roomId, userId, wsClient]);

  const handleAddPhase = () => {
    const phase: MeetingPhase = {
      id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: '自定义阶段',
      hint: '写下这个阶段希望团队完成的事情。',
      templateId: 'kanban',
    };
    setPhases((current) => {
      const next = [...current, phase];
      broadcastPhases(next);
      return next;
    });
    setActivePhaseId(phase.id);
  };

  const handleRemovePhase = (phaseId: MeetingPhaseId) => {
    setPhases((current) => {
      if (current.length <= 1) return current;
      const index = current.findIndex((phase) => phase.id === phaseId);
      const next = current.filter((phase) => phase.id !== phaseId);
      if (activePhaseId === phaseId) {
        setActivePhaseId(next[Math.max(0, index - 1)]?.id ?? next[0].id);
      }
      broadcastPhases(next);
      return next;
    });
  };

  const handleUpdatePhase = (phaseId: MeetingPhaseId, patch: Partial<MeetingPhase>) => {
    setPhases((current) => {
      const next = current.map((phase) => (
        phase.id === phaseId ? { ...phase, ...patch, id: phase.id } : phase
      ));
      broadcastPhases(next);
      return next;
    });
  };

  const handleMeetingBarHeight = useCallback((h: number) => {
    shellRef.current?.style.setProperty('--meeting-bar-height', `${h}px`);
  }, []);

  const handleSendChatMessage = useCallback((text: string) => {
    if (!text.trim() || !roomId) return;
    const timestamp = Date.now();
    const msg = { id: `${userId}-${timestamp}`, userId, displayName, color, text, timestamp };
    setChatMessages((prev) => [...prev, msg]);
    wsClient?.sendJson({ type: 'room-chat', msgId: msg.id, roomId, userId, displayName, color, text, timestamp });
  }, [roomId, userId, displayName, color, wsClient]);

  const handleSendEmoji = useCallback((emoji: string) => {
    if (!roomId) return;
    wsClient?.sendJson({ type: 'room-emoji', msgId: `${userId}-${Date.now()}`, roomId, userId, emoji });
  }, [roomId, userId, wsClient]);

  const handleImportFile = async (file: File) => {
    try {
      const contents = await file.text();
      const center = viewportCenter();
      const result = createImportOps(file.name, contents, center.x - 420, center.y - 220);
      runHistoryBatch(() => {
        result.ops.forEach(sendShapeOp);
      });
      window.requestAnimationFrame(fitViewportToContent);
      setEvents((current) => [`imported ${result.itemCount} ${result.format} item(s) in ${result.sectionCount} section(s)`, ...current].slice(0, 5));
    } catch (err) {
      setEvents((current) => [`import failed: ${err instanceof Error ? err.message : 'unknown'}`, ...current].slice(0, 5));
    }
  };

  const createCardAt = (point: { x: number; y: number }, attrs: Partial<ShapeAttrs> = {}) => {
    sendShapeOp(createCardOp(point.x - 130, point.y - 84, attrs));
    setActiveTool('select');
  };

  const createCommentAt = (point: { x: number; y: number }) => {
    sendShapeOp(createShapeOp('comment', point.x - 110, point.y - 43));
    setActiveTool('select');
  };

  // Build compact board context for AI, including real shape IDs so the AI can
  // target existing objects with update/delete instead of only creating new ones.
  const buildBoardContext = useCallback(() => {
    const activePhase = phases.find((p) => p.id === activePhaseId);
    const contextShapes = [...allShapes]
      .sort((a, b) => (a.attrs.y ?? 0) - (b.attrs.y ?? 0) || (a.attrs.x ?? 0) - (b.attrs.x ?? 0))
      .slice(0, 80);
    const lines: string[] = [
      `当前会议阶段：${activePhase?.label ?? '未知'}（${activePhase?.hint ?? ''}）`,
      `阶段进度：${phases.findIndex((p) => p.id === activePhaseId) + 1} / ${phases.length}`,
      `白板图形总数：${allShapes.length}`,
      '',
      '白板现有图形（id 可用于 update/delete 操作，格式 [类型] id @(x,y) 尺寸 文字/状态）：',
    ];
    contextShapes.forEach((shape) => {
      const r = shapeToExportRecord(shape);
      const label = r.title || r.body || shape.attrs.text || '（无文字）';
      const x = Math.round(shape.attrs.x ?? 0);
      const y = Math.round(shape.attrs.y ?? 0);
      const size = shape.attrs.radius
        ? `r=${Math.round(shape.attrs.radius)}`
        : `${Math.round(shape.attrs.w ?? 0)}x${Math.round(shape.attrs.h ?? 0)}`;
      const meta = [r.status, r.priority].filter(Boolean).join('/');
      lines.push(`- [${shape.type}] ${shape.id} @(${x},${y}) ${size} "${String(label).slice(0, 50)}"${meta ? ` {${meta}}` : ''}`);
    });
    if (allShapes.length > contextShapes.length) {
      lines.push(`- 另有 ${allShapes.length - contextShapes.length} 个图形未展开，请优先基于已列出的对象进行精确修改。`);
    }

    if (chatMessages.length > 0) {
      lines.push('', '最近会议对话（最多 30 条）：');
      chatMessages.slice(-30).forEach((msg) => {
        lines.push(`- ${msg.displayName}: ${msg.text.slice(0, 160)}`);
      });
    }

    // Compute bounding box to suggest AI start position
    if (allShapes.length > 0) {
      const maxX = Math.max(...allShapes.map((s) => (s.attrs.x ?? 0) + (s.attrs.w ?? 200)));
      const maxY = Math.max(...allShapes.map((s) => (s.attrs.y ?? 0) + (s.attrs.h ?? 100)));
      lines.push('', `建议起始坐标：x = ${Math.round(maxX + 120)}, y = 100；若横向空间不足，可用 x = 200, y = ${Math.round(maxY + 120)}`);
    } else {
      lines.push('', '建议起始坐标：x = 200, y = 200');
    }
    return lines.join('\n');
  }, [phases, activePhaseId, allShapes, chatMessages]);

  const handleAiOps = useCallback((ops: Array<Record<string, unknown>>) => {
    const safeOps = ops
      .map((op, index) => sanitizeAiOp(op, index))
      .filter((op): op is ShapeOperation => op !== null);
    const skipped = ops.length - safeOps.length;

    if (ops.length > 0 && safeOps.length === 0) {
      setEvents((current) => ['AI returned no safe canvas operations', ...current].slice(0, 5));
      return;
    }

    runHistoryBatch(() => {
      safeOps.forEach((op) => sendShapeOp(op));
    });
    window.requestAnimationFrame(fitViewportToContent);
    setEvents((current) => [
      `AI applied ${safeOps.length} op(s)${skipped ? `, skipped ${skipped}` : ''}`,
      ...current,
    ].slice(0, 5));
  }, [fitViewportToContent, runHistoryBatch, sendShapeOp]);

  const handleAiChat = useCallback(async (prompt: string) => {
    const { orchestrateWithAi } = await import('../network/api');
    const boardContext = buildBoardContext();
    const res = await orchestrateWithAi(roomId, prompt, boardContext);
    if (res.ops && res.ops.length > 0) handleAiOps(res.ops);
    return res;
  }, [roomId, buildBoardContext, handleAiOps]);

  const handleAiSummarize = useCallback(async (): Promise<string> => {
    const { summarizeWithAi } = await import('../network/api');
    const boardContext = buildBoardContext();
    const prompt = `请根据本次会议的完整白板内容，生成一份会议总结。包含：
1. 本次会议的核心目标和结论（2-3条）
2. 讨论中识别到的主要风险或待决策项
3. 明确的行动项（含建议优先级）
4. 整体进展评估（是否达到会议目标）
请以结构化的方式呈现，便于会后同步。`;
    const res = await summarizeWithAi(roomId, prompt, boardContext);
    return res.markdown;
  }, [roomId, buildBoardContext]);

  const handleProductUpdate = (attrs: ShapeOperation['attrs']) => {
    if (!selectedShape) {
      return;
    }

    const nextAttrs = { ...attrs };
    if (attrs?.priority) {
      const palette = cardPalette[attrs.priority];
      nextAttrs.fill = palette.fill;
      nextAttrs.stroke = palette.stroke;
    }

    sendShapeOp({
      opType: 'update',
      shapeId: selectedShape.id,
      shapeType: selectedShape.type,
      attrs: nextAttrs,
    });
  };

  const handleVoteSelected = () => {
    if (!selectedShape || selectedShape.type !== 'card') {
      return;
    }

    const voters = selectedShape.attrs.voters ?? [];
    const hasVoted = voters.includes(userId);
    const nextVoters = hasVoted ? voters.filter((voterId) => voterId !== userId) : [...voters, userId];
    handleProductUpdate({
      voters: nextVoters,
      votes: nextVoters.length,
    });
  };

  const handleLayerChange = (direction: 'front' | 'back') => {
    const shapesToUpdate = shapesForSelection();
    if (shapesToUpdate.length === 0) {
      return;
    }

    const shapes = Object.values(useShapeStore.getState().shapes);
    const zValues = shapes.map((shape) => shape.attrs.zIndex ?? 0);
    const maxZ = Math.max(0, ...zValues);
    const minZ = Math.min(0, ...zValues);

    runHistoryBatch(() => {
      shapesToUpdate.forEach((shape, index) => {
        sendShapeOp({
          opType: 'update',
          shapeId: shape.id,
          shapeType: shape.type,
          attrs: {
            zIndex: direction === 'front' ? maxZ + index + 1 : minZ - index - 1,
          },
        });
      });
    });
  };

  const zoomBy = (factor: number) => {
    const nextScale = Math.min(2.4, Math.max(0.35, viewport.scale * factor));
    const center = { x: stageSize.width / 2, y: stageSize.height / 2 };
    const canvasCenter = {
      x: (center.x - viewport.x) / viewport.scale,
      y: (center.y - viewport.y) / viewport.scale,
    };
    setViewport({
      scale: nextScale,
      x: center.x - canvasCenter.x * nextScale,
      y: center.y - canvasCenter.y * nextScale,
    });
  };

  const fitViewport = () => {
    fitViewportToContent();
  };

  const copySelected = useCallback(() => {
    const shapesToCopy = shapesForSelection();
    clipboardRef.current = shapesToCopy.map((shape) => ({
      opType: 'create',
      shapeId: shape.id,
      shapeType: shape.type,
      attrs: { ...shape.attrs },
    }));
    if (shapesToCopy.length > 0) {
      setEvents((current) => [`copied ${shapesToCopy.length} item(s)`, ...current].slice(0, 5));
    }
  }, [shapesForSelection]);

  const pasteClipboard = useCallback((offset = 36, targetPoint?: { x: number; y: number }) => {
    if (clipboardRef.current.length === 0) {
      return;
    }

    const xs = clipboardRef.current.map((item) => item.attrs?.x ?? 0);
    const ys = clipboardRef.current.map((item) => item.attrs?.y ?? 0);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);

    const pastedIds: string[] = [];
    runHistoryBatch(() => {
      clipboardRef.current.forEach((item, index) => {
        const shapeId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `paste-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
        pastedIds.push(shapeId);
        sendShapeOp({
          opType: 'create',
          shapeId,
          shapeType: item.shapeType,
          attrs: {
            ...item.attrs,
            x: targetPoint ? targetPoint.x + ((item.attrs?.x ?? 0) - minX) : (item.attrs?.x ?? 0) + offset,
            y: targetPoint ? targetPoint.y + ((item.attrs?.y ?? 0) - minY) : (item.attrs?.y ?? 0) + offset,
            zIndex: Date.now() + index,
            groupId: item.attrs?.groupId ? `${item.attrs.groupId}-copy-${Date.now()}` : undefined,
          },
        });
      });
    });
    useShapeStore.getState().setSelectedIds(pastedIds);
  }, [runHistoryBatch, sendShapeOp]);

  const duplicateSelected = useCallback((offset = 36) => {
    const shapesToCopy = shapesForSelection();
    if (shapesToCopy.length === 0) {
      return;
    }

    clipboardRef.current = shapesToCopy.map((shape) => ({
      opType: 'create',
      shapeId: shape.id,
      shapeType: shape.type,
      attrs: { ...shape.attrs },
    }));
    pasteClipboard(offset);
  }, [pasteClipboard, shapesForSelection]);

  const selectAllShapes = useCallback(() => {
    const selectableIds = Object.values(useShapeStore.getState().shapes)
      .filter((shape) => shape.type !== 'connector')
      .map((shape) => shape.id);
    useShapeStore.getState().setSelectedIds(selectableIds);
    setActiveGroupId(null);
    setEvents((current) => [`selected ${selectableIds.length} item(s)`, ...current].slice(0, 5));
  }, []);

  const cutSelected = useCallback(() => {
    const shapesToCut = shapesForSelection();
    if (shapesToCut.length === 0) {
      return;
    }

    copySelected();
    runHistoryBatch(() => {
      shapesToCut.forEach((shape) => {
        sendShapeOp({
          opType: 'delete',
          shapeId: shape.id,
          shapeType: shape.type,
        });
      });
    });
    setActiveGroupId(null);
    setEvents((current) => [`cut ${shapesToCut.length} item(s)`, ...current].slice(0, 5));
  }, [copySelected, runHistoryBatch, sendShapeOp, shapesForSelection]);

  const moveSelected = useCallback((dx: number, dy: number, duplicateBeforeMove = false) => {
    const shapesToMove = shapesForSelection();
    if (shapesToMove.length === 0) {
      return;
    }

    if (duplicateBeforeMove) {
      duplicateSelected(0);
    }

    runHistoryBatch(() => {
      shapesToMove.forEach((shape) => {
        sendShapeOp({
          opType: 'update',
          shapeId: shape.id,
          shapeType: shape.type,
          attrs: {
            x: Math.round(shape.attrs.x + dx),
            y: Math.round(shape.attrs.y + dy),
          },
        });
      });
    });
  }, [duplicateSelected, runHistoryBatch, sendShapeOp, shapesForSelection]);

  const groupSelected = useCallback(() => {
    const shapesToGroup = shapesForSelection();
    if (shapesToGroup.length < 2) {
      return;
    }

    const groupId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    runHistoryBatch(() => {
      shapesToGroup.forEach((shape) => {
        sendShapeOp({
          opType: 'update',
          shapeId: shape.id,
          shapeType: shape.type,
          attrs: { groupId, groupName: 'Group' },
        });
      });
    });
    setActiveGroupId(groupId);
  }, [runHistoryBatch, sendShapeOp, shapesForSelection]);

  const ungroupSelected = useCallback(() => {
    const shapesToUngroup = shapesForSelection();
    runHistoryBatch(() => {
      shapesToUngroup.forEach((shape) => {
        sendShapeOp({
          opType: 'update',
          shapeId: shape.id,
          shapeType: shape.type,
          attrs: { groupId: null, groupName: null },
        });
      });
    });
    setActiveGroupId(null);
  }, [runHistoryBatch, sendShapeOp, shapesForSelection]);

  const exportPng = () => {
    const canvas = stageRef.current?.querySelector('canvas');
    if (!canvas) {
      setEvents((current) => ['export failed: canvas not ready', ...current].slice(0, 5));
      return;
    }

    const link = document.createElement('a');
    link.download = `cocanvas-${roomId || 'board'}.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    setEvents((current) => ['exported PNG', ...current].slice(0, 5));
  };

  const exportProductMarkdown = () => {
    downloadTextFile(
      `cocanvas-${roomId || 'board'}-summary.md`,
      exportMarkdown(roomId, allShapes),
      'text/markdown'
    );
    setEvents((current) => ['exported Markdown', ...current].slice(0, 5));
  };

  const exportProductJson = () => {
    downloadTextFile(
      `cocanvas-${roomId || 'board'}-board.json`,
      JSON.stringify(allShapes.map(shapeToExportRecord), null, 2),
      'application/json'
    );
    setEvents((current) => ['exported JSON', ...current].slice(0, 5));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') {
        return;
      }

      const isModifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (isModifier && key === 'a') {
        event.preventDefault();
        selectAllShapes();
        return;
      }

      if (isModifier && key === 'x') {
        event.preventDefault();
        cutSelected();
        return;
      }

      if (isModifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          redoLastAction();
        } else {
          undoLastAction();
        }
        return;
      }

      if (isModifier && key === 'y') {
        event.preventDefault();
        redoLastAction();
        return;
      }

      if (isModifier && key === 'c') {
        event.preventDefault();
        copySelected();
        return;
      }

      if (isModifier && key === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }

      if (isModifier && key === 'v') {
        event.preventDefault();
        pasteClipboard(event.shiftKey ? 12 : 36, lastCanvasPointRef.current ?? undefined);
        return;
      }

      if (isModifier && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) {
          ungroupSelected();
        } else {
          groupSelected();
        }
        return;
      }

      if (isModifier && event.key === '/') {
        event.preventDefault();
        setShortcutsOpen(true);
        return;
      }

      if (event.key === 'Escape') {
        setContextMenu(null);
        setShortcutsOpen(false);
        setActiveTool('select');
      }

      const arrowDelta = event.shiftKey ? 10 : 1;
      if (event.key === 'ArrowUp' || event.key === 'ArrowDown' || event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (!selectedShape && selectedIds.length === 0) {
          return;
        }

        event.preventDefault();
        const dx = event.key === 'ArrowLeft' ? -arrowDelta : event.key === 'ArrowRight' ? arrowDelta : 0;
        const dy = event.key === 'ArrowUp' ? -arrowDelta : event.key === 'ArrowDown' ? arrowDelta : 0;
        moveSelected(dx, dy, event.altKey);
        return;
      }

      if (key === 'v') {
        setActiveTool('select');
      }
      if (key === 'h') {
        setActiveTool('hand');
      }
      if (key === 'n') {
        setActiveTool('sticky');
      }
      if (key === 'k') {
        setActiveTool('card');
      }
      if (key === 't') {
        setActiveTool('text');
      }
      if (key === 'p') {
        setActiveTool('pen');
      }
      if (key === 'c') {
        setActiveTool('comment');
      }
      if (key === 'f') {
        setActiveTool('frame');
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      if (!selectedShape && selectedIds.length === 0) {
        return;
      }

      event.preventDefault();
      handleDeleteSelected();
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [copySelected, cutSelected, duplicateSelected, groupSelected, handleDeleteSelected, moveSelected, pasteClipboard, redoLastAction, selectAllShapes, selectedIds.length, selectedShape, undoLastAction, ungroupSelected]);

  useEffect(() => {
    if (!activeGroupId) {
      return;
    }

    const hasActiveGroupSelection = selectedIds.some((shapeId) => shapeMap[shapeId]?.attrs.groupId === activeGroupId);
    const groupStillExists = Object.values(shapeMap).some((shape) => shape.attrs.groupId === activeGroupId);
    if (!hasActiveGroupSelection || !groupStillExists) {
      setActiveGroupId(null);
    }
  }, [activeGroupId, selectedIds, shapeMap]);

  // Poll performance metrics every 10 s — cache hit rate + WS queue stats
  useEffect(() => {
    const poll = async () => {
      try {
        const [cs, qs] = await Promise.all([fetchCacheStats(), fetchQueueStats()]);
        setCacheStats(cs);
        setQueueStats(qs);
      } catch {
        // metrics are best-effort; silently ignore errors
      }
    };
    poll();
    const id = setInterval(poll, 10_000);
    return () => clearInterval(id);
  }, []);

  // Load anchors once when room becomes ready
  useEffect(() => {
    if (roomAccessState !== 'ready' || !roomId) return;
    fetchHistoryAnchors(roomId).then(setHistoryAnchors).catch(() => {});
  }, [roomAccessState, roomId]);

  const handleApplyHistory = useCallback(async (at: number) => {
    setHistoryAt(at);
    setHistoryLoading(true);
    try {
      const history = await getRoomHistory(roomId, at);
      const preview = summarizeHistoryState(history, at);
      setHistoryPreview(preview);
      applyHistoryState(history);
      setHistoryMode(true);
    } catch (err) {
      setEvents((current) => [`history error: ${err instanceof Error ? err.message : 'unknown'}`, ...current].slice(0, 5));
    } finally {
      setHistoryLoading(false);
    }
  }, [roomId, summarizeHistoryState, applyHistoryState]);

  const handleExitHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      await restoreLatestState();
      setHistoryMode(false);
      setHistoryPreview(null);
    } finally {
      setHistoryLoading(false);
    }
  }, [restoreLatestState]);

  const connectedNode = useMemo(() => {
    if (!roomWsUrl) {
      return 'n/a';
    }

    const match = roomWsUrl.match(/\/ws\/([^/]+)\//);
    return match?.[1] ?? 'direct';
  }, [roomWsUrl]);

  const canManageMembers = roomMemberRole === 'owner';
  const canClaimOwner = Boolean(authToken && roomAccessState === 'ready' && members.length === 0);

  // 成员权限面板内容，作为 slot 注入底部 MeetingBar 的「成员权限」标签
  const membersSlot = (
    <>
      <div className="member-strip">
        {members.map((member) => {
          // 显示名/颜色取实时身份（本地用户或在线 peer 的会话别名），数据库值仅作离线兜底
          const isSelf = member.userId === userId;
          const peer = remotes[member.userId];
          const online = isSelf || Boolean(peer);
          const liveName = isSelf ? displayName : (peer?.displayName ?? member.displayName);
          const liveColor = isSelf ? color : (peer?.color ?? '#94a3b8');
          return (
          <div key={member.userId} className="member-chip">
            <span className="member-dot" style={{ background: liveColor }} />
            <span className={`member-presence${online ? ' online' : ''}`} title={online ? '在线' : '离线'} />
            <strong>{liveName}</strong>
            <small>@{member.username || member.userId.slice(0, 8)}</small>
            {canManageMembers ? (
              <select
                value={member.role}
                onChange={(event) => void handleChangeMemberRole(member, event.target.value as RoomMember['role'])}
                disabled={member.userId === userId && member.role === 'owner'}
              >
                <option value="owner">owner</option>
                <option value="edit">edit</option>
                <option value="comment">comment</option>
                <option value="view">view</option>
              </select>
            ) : (
              <em>{member.role}</em>
            )}
            {canManageMembers && member.userId !== userId && (
              <button type="button" onClick={() => void handleRemoveMember(member)}>移除</button>
            )}
          </div>
          );
        })}
        {members.length === 0 && <span className="member-empty">当前房间还没有账号成员，继续兼容密码 / join token 进入。</span>}
      </div>
      {canManageMembers && (
        <form
          className="member-add-form"
          onSubmit={(event) => {
            event.preventDefault();
            void handleSaveMember();
          }}
        >
          <UserPlus size={15} aria-hidden />
          <input value={memberUsername} placeholder="输入对方用户名" onChange={(event) => setMemberUsername(event.target.value)} />
          <select value={memberRole} onChange={(event) => setMemberRole(event.target.value as RoomMember['role'])}>
            <option value="edit">可编辑</option>
            <option value="comment">可评论</option>
            <option value="view">只读</option>
            <option value="owner">owner</option>
          </select>
          <button type="submit">添加/更新</button>
        </form>
      )}
      {canClaimOwner && (
        <button type="button" className="claim-owner-btn" onClick={() => void handleClaimOwner()}>
          认领为房间 owner
        </button>
      )}
      {membersLoading && <small className="member-hint">同步中…</small>}
      {authToken && !canManageMembers && members.length > 0 && (
        <small className="member-hint">当前账号 {username ? `@${username}` : ''} 不是 owner，只能查看成员。</small>
      )}
      {memberError && <small className="member-error">{memberError}</small>}
    </>
  );

  // 进入房间前必须登录：未登录直接挡在门外，引导回控制台登录
  if (!authToken || !username) {
    return (
      <main className="room-gate">
        <section className="room-gate-panel">
          <Link to="/" className="back-link"><ArrowLeft size={15} aria-hidden /> 房间控制台</Link>
          <h1>请先登录</h1>
          <p>进入协作房间前需要登录账号。请返回控制台登录后再进入。</p>
          <Link to="/" className="gate-primary-link">去登录</Link>
        </section>
      </main>
    );
  }

  if (roomAccessState !== 'ready') {
    return (
      <main className="room-gate">
        <section className="room-gate-panel">
          <Link to="/" className="back-link"><ArrowLeft size={15} aria-hidden /> 房间控制台</Link>
          <h1>{roomAccessState === 'missing' ? '房间不存在或已归档' : roomAccessState === 'password' ? '需要房间密码' : '正在检查房间'}</h1>
          {roomAccessState === 'password' && (
            <form
              className="gate-form"
              onSubmit={(event) => {
                event.preventDefault();
                void handlePasswordSubmit();
              }}
            >
              <input
                type="password"
                value={roomPassword}
                placeholder="输入房间密码"
                onChange={(event) => {
                  setRoomPassword(event.target.value);
                  setRoomPasswordError(null);
                }}
              />
              {roomPasswordError && <p className="error-text">{roomPasswordError}</p>}
              <button type="submit">
                <LockIcon size={16} aria-hidden />
                <span>进入房间</span>
              </button>
            </form>
          )}
          {roomAccessState === 'checking' && <p>正在确认房间号、权限和会议配置。</p>}
          {roomAccessState === 'missing' && <p>请返回控制台创建房间，或检查房间号是否正确。</p>}
        </section>
      </main>
    );
  }

  const contextMenuCanvasPoint = contextMenu
    ? screenToCanvasPoint({
      x: contextMenu.x - (stageRef.current?.getBoundingClientRect().left ?? 0),
      y: contextMenu.y - (stageRef.current?.getBoundingClientRect().top ?? 0),
    })
    : null;

  return (
    <main className="whiteboard-shell" ref={shellRef}>
      <header className="whiteboard-topbar" ref={topbarRef}>
        <div>
          <Link to="/" className="back-link"><ArrowLeft size={15} aria-hidden /> Home</Link>
          <h1>{roomName || 'Cocanvas board'}</h1>
          <p>Room {roomId}</p>
        </div>
        <UserIdentityEditor compact />
        <div className="room-stats">
          <div className="undo-redo-btns">
            <button
              type="button"
              className="undo-redo-btn"
              onClick={undoLastAction}
              disabled={undoCount === 0}
              title="撤销 (Ctrl+Z)"
              aria-label="撤销"
            >
              <Undo2 size={15} />
            </button>
            <button
              type="button"
              className="undo-redo-btn"
              onClick={redoLastAction}
              disabled={redoCount === 0}
              title="重做 (Ctrl+Y)"
              aria-label="重做"
            >
              <Redo2 size={15} />
            </button>
          </div>
          <span>WS: <strong>{status}</strong></span>
          <span>Peers: <strong>{remoteCount}</strong></span>
          <span>Perm: <strong>{roomPermissionMode}</strong></span>
          {roomMemberRole && <span>Role: <strong>{roomMemberRole}</strong></span>}
          <span>Tool: <strong>{activeTool}</strong></span>
        </div>
        <div className="collab-diagnostics" title={roomWsUrl || 'No websocket URL yet'}>
          <span>Node <strong>{connectedNode}</strong></span>
          <span>Reconnect <strong>{reconnectAttempts}</strong></span>
          <span>Pending <strong>{pendingOpsCount}</strong></span>
          <span>Restore <strong>{lastRestoredOps}</strong></span>
          <span>Replay <strong>{lastReplayedOps}</strong></span>
          <span>Flush <strong>{lastFlushedOps}</strong></span>
          {cacheStats && (
            <span title={`Hits: ${cacheStats.hitCount} / Misses: ${cacheStats.missCount} / Loads: ${cacheStats.loadCount} (${cacheStats.totalLoadMs}ms)`}>
              Cache <strong>{(cacheStats.hitRate * 100).toFixed(1)}%</strong>
            </span>
          )}
          {queueStats && (
            <span title={`Active sessions: ${queueStats.activeSessions} / Queued: ${queueStats.totalQueuedMessages} / Drops: ${queueStats.transientDrops} / Disconnects: ${queueStats.overloadDisconnects}`}>
              Q <strong>{queueStats.totalQueuedMessages}</strong>
              {queueStats.transientDrops > 0 && <> Drop <strong className="diag-warn">{queueStats.transientDrops}</strong></>}
              {queueStats.overloadDisconnects > 0 && <> OL <strong className="diag-error">{queueStats.overloadDisconnects}</strong></>}
            </span>
          )}
        </div>
      </header>

      <Toolbar
        activeTool={activeTool}
        selectedId={selectedId}
        onSelectTool={handleToolSelect}
        onDeleteSelected={handleDeleteSelected}
      />

      <ProductPanel
        shapes={allShapes}
        selectedShape={selectedShape}
        selectedCount={selectedShapes.length}
        query={productQuery}
        statusFilter={statusFilter}
        tagFilter={tagFilter}
        activePhaseId={activePhaseId}
        phases={phases}
        onQueryChange={setProductQuery}
        onStatusFilterChange={setStatusFilter}
        onTagFilterChange={setTagFilter}
        onPhaseChange={handlePhaseChange}
        onPhaseStep={handlePhaseStep}
        onInsertPhaseTemplate={handleInsertPhaseTemplate}
        onAddPhase={handleAddPhase}
        onRemovePhase={handleRemovePhase}
        onUpdatePhase={handleUpdatePhase}
        onImportFile={handleImportFile}
        onCreateCard={handleCreateCard}
        onTemplateInsert={handleTemplateInsert}
        onUpdateSelected={handleProductUpdate}
        onVoteSelected={handleVoteSelected}
        onDeleteSelected={handleDeleteSelected}
        onLayerChange={handleLayerChange}
        onExportMarkdown={exportProductMarkdown}
        onExportJson={exportProductJson}
      />

      <section
        className="canvas-stage whiteboard-canvas"
        ref={stageRef}
        onMouseMove={handleMouseMove}
        onClick={() => setContextMenu(null)}
        onContextMenu={(event) => {
          // CanvasBoard opens the menu on right-mouse-up; just block the native menu here
          event.preventDefault();
        }}
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleToolDrop}
      >
        <CanvasBoard
          width={stageSize.width}
          height={stageSize.height}
          activeTool={activeTool}
          viewport={viewport}
          previewPositions={previewPositions}
          penPreviews={penPreviews}
          visibleShapeIds={visibleShapeIds}
          onSelectionChange={setSelectionWithGroups}
          activeGroupId={activeGroupId}
          onViewportChange={setViewport}
          onShapePreview={handleShapePreview}
          onShapeCommit={handleShapeCommit}
          onOpenContextMenu={setContextMenu}
          onCreateShape={(op) => {
            sendShapeOp(op);
            setActiveTool('select');
          }}
        />
        <CursorLayer viewport={viewport} />
        <MeetingBar
          phases={phases}
          activePhaseId={activePhaseId}
          activePhaseIndex={phases.findIndex((p) => p.id === activePhaseId)}
          userId={userId}
          color={color}
          onPhaseChange={handlePhaseChange}
          onPhaseStep={handlePhaseStep}
          historyAt={historyAt}
          historyLoading={historyLoading}
          historyPreview={historyPreview}
          historyAnchors={historyAnchors}
          historyMode={historyMode}
          onHistoryAtChange={setHistoryAt}
          onApplyHistory={handleApplyHistory}
          onExitHistory={handleExitHistory}
          onHeightChange={handleMeetingBarHeight}
          voiceEnabled={roomVoiceEnabled}
          micEnabled={micEnabled}
          micError={micError}
          onToggleMic={() => void toggleMicrophone()}
          onAiChat={handleAiChat}
          onAiSummarize={handleAiSummarize}
          membersSlot={membersSlot}
          chatMessages={chatMessages}
          onSendMessage={handleSendChatMessage}
          onSendEmoji={handleSendEmoji}
          remoteEmoji={remoteEmoji}
        />
        {historyMode && (
          <div className="history-mode-banner">
            <span>历史回放模式 · {new Date(historyAt).toLocaleString()}</span>
            <button type="button" onClick={() => void handleExitHistory()}>返回实时</button>
          </div>
        )}
        <div className="zoom-controls" aria-label="Zoom controls">
          <button type="button" title="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard size={16} aria-hidden /></button>
          <button type="button" title="Zoom out" onClick={() => zoomBy(0.9)}><ZoomOut size={16} aria-hidden /></button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" title="Zoom in" onClick={() => zoomBy(1.1)}><ZoomIn size={16} aria-hidden /></button>
          <button type="button" title="Fit to content" onClick={fitViewport}><AlignCenter size={16} aria-hidden /></button>
          <button type="button" title="Export PNG" onClick={exportPng}><ImageDown size={16} aria-hidden /></button>
        </div>
      </section>

      {contextMenu && (
        <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} role="menu" onClick={(event) => event.stopPropagation()}>
          <button type="button" onClick={() => { if (contextMenuCanvasPoint) createCardAt(contextMenuCanvasPoint); setContextMenu(null); }}>
            <PlusCircle size={15} aria-hidden /><span>New card here</span><kbd>K</kbd>
          </button>
          <button type="button" onClick={() => { if (contextMenuCanvasPoint) createCommentAt(contextMenuCanvasPoint); setContextMenu(null); }}>
            <MessageSquarePlus size={15} aria-hidden /><span>Comment here</span><kbd>C</kbd>
          </button>
          <button type="button" onClick={() => { if (contextMenuCanvasPoint) insertTemplateAt(activeMeetingPhase.templateId, { x: contextMenuCanvasPoint.x - 420, y: contextMenuCanvasPoint.y - 220 }); setContextMenu(null); }}>
            <Goal size={15} aria-hidden /><span>Phase template</span>
          </button>
          <button type="button" onClick={() => { copySelected(); setContextMenu(null); }}>
            <Copy size={15} aria-hidden /><span>Copy</span><kbd>Ctrl C</kbd>
          </button>
          <button type="button" onClick={() => { cutSelected(); setContextMenu(null); }}>
            <Scissors size={15} aria-hidden /><span>Cut</span><kbd>Ctrl X</kbd>
          </button>
          <button type="button" onClick={() => { duplicateSelected(); setContextMenu(null); }}>
            <Scissors size={15} aria-hidden /><span>Duplicate</span><kbd>Ctrl D</kbd>
          </button>
          <button type="button" onClick={() => { pasteClipboard(0, contextMenuCanvasPoint ?? undefined); setContextMenu(null); }}>
            <MousePointer2 size={15} aria-hidden /><span>Paste</span><kbd>Ctrl V</kbd>
          </button>
          <button type="button" onClick={() => { groupSelected(); setContextMenu(null); }}>
            <Link2 size={15} aria-hidden /><span>Group</span><kbd>Ctrl G</kbd>
          </button>
          <button type="button" onClick={() => { ungroupSelected(); setContextMenu(null); }}>
            <Unlink2 size={15} aria-hidden /><span>Ungroup</span><kbd>Ctrl Shift G</kbd>
          </button>
          <button type="button" onClick={() => { handleLayerChange('front'); setContextMenu(null); }}>
            <ArrowUpToLine size={15} aria-hidden /><span>Bring front</span>
          </button>
          <button type="button" onClick={() => { handleLayerChange('back'); setContextMenu(null); }}>
            <ArrowDownToLine size={15} aria-hidden /><span>Send back</span>
          </button>
          <button type="button" onClick={() => { handleDeleteSelected(); setContextMenu(null); }}>
            <Trash2 size={15} aria-hidden /><span>Delete</span><kbd>Del</kbd>
          </button>
        </div>
      )}

      {shortcutsOpen && (
        <div className="shortcut-overlay" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts" onClick={() => setShortcutsOpen(false)}>
          <section className="shortcut-dialog" onClick={(event) => event.stopPropagation()}>
            <header>
              <Keyboard size={18} aria-hidden />
              <strong>Keyboard shortcuts</strong>
              <button type="button" onClick={() => setShortcutsOpen(false)}>Close</button>
            </header>
            <div className="shortcut-grid">
              <div><kbd>V</kbd><span>Select</span></div>
              <div><kbd>H</kbd><span>Hand / pan</span></div>
              <div><kbd>N</kbd><span>Sticky note</span></div>
              <div><kbd>K</kbd><span>Product card</span></div>
              <div><kbd>T</kbd><span>Text</span></div>
              <div><kbd>P</kbd><span>Pen</span></div>
              <div><kbd>C</kbd><span>Comment</span></div>
              <div><kbd>F</kbd><span>Frame</span></div>
              <div><kbd>Ctrl/Cmd A</kbd><span>Select all items</span></div>
              <div><kbd>Ctrl/Cmd C</kbd><span>Copy selection</span></div>
              <div><kbd>Ctrl/Cmd X</kbd><span>Cut selection</span></div>
              <div><kbd>Ctrl/Cmd V</kbd><span>Paste selection</span></div>
              <div><kbd>Ctrl/Cmd Z</kbd><span>Undo last action</span></div>
              <div><kbd>Ctrl/Cmd Y</kbd><span>Redo last action</span></div>
              <div><kbd>Ctrl/Cmd Shift Z</kbd><span>Redo last action</span></div>
              <div><kbd>Ctrl/Cmd D</kbd><span>Duplicate selection</span></div>
              <div><kbd>Delete</kbd><span>Delete selection</span></div>
              <div><kbd>Arrow</kbd><span>Move 1px</span></div>
              <div><kbd>Shift Arrow</kbd><span>Move 10px</span></div>
              <div><kbd>Alt Arrow</kbd><span>Copy then move</span></div>
              <div><kbd>Ctrl/Cmd G</kbd><span>Group selection</span></div>
              <div><kbd>Ctrl/Cmd Shift G</kbd><span>Ungroup selection</span></div>
              <div><kbd>Ctrl/Cmd click</kbd><span>Add or remove one item</span></div>
              <div><kbd>Click grouped item</kbd><span>Select the whole group</span></div>
              <div><kbd>Click selected group item</kbd><span>Edit one item inside</span></div>
              <div><kbd>Ctrl/Cmd drag</kbd><span>Copy while dragging</span></div>
              <div><kbd>Alt drag</kbd><span>Copy while dragging</span></div>
              <div><kbd>Shift drag</kbd><span>Lock horizontal / vertical</span></div>
              <div><kbd>Ctrl/Cmd Shift drag</kbd><span>Copy and lock axis</span></div>
              <div><kbd>Ctrl/Cmd /</kbd><span>Show shortcuts</span></div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

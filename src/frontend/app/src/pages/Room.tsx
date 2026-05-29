import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import {
  AlignCenter,
  ArrowLeft,
  ArrowDownToLine,
  ArrowUpToLine,
  AudioLines,
  Copy,
  Download,
  Goal,
  History,
  ImageDown,
  Keyboard,
  Link2,
  MessageSquarePlus,
  Lock as LockIcon,
  MousePointer2,
  PlusCircle,
  Mic,
  MicOff,
  Unlink2,
  Scissors,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { CanvasBoard, type SelectionChangeOptions, type ViewportState } from '../components/CanvasBoard';
import { CursorLayer } from '../components/CursorLayer';
import { ProductPanel } from '../components/ProductPanel';
import { Toolbar, type ToolMode } from '../components/Toolbar';
import { UserIdentityEditor } from '../components/UserIdentityEditor';
import { HybridLogicalClock } from '../crdt/hlc';
import { getRoom, getRoomHistory, type HistoryResponse } from '../network/api';
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
const shapePreviewIntervalMs = 16;
const reconnectDelays = [1000, 2000, 4000, 8000, 15000];
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

const isDraggableCreateTool = (tool: string): tool is Extract<ShapeType, ToolMode> => (
  draggableCreateTools.has(tool as ToolMode)
);

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
    return parsed as Record<string, Record<string, unknown>>;
  }

  return {};
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
  const [events, setEvents] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(() => Date.now());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomWsUrl, setRoomWsUrl] = useState('');
  const [roomPassword, setRoomPassword] = useState(() => searchParams.get('password') ?? '');
  const [roomAccessState, setRoomAccessState] = useState<'checking' | 'ready' | 'password' | 'missing'>('checking');
  const [roomPasswordError, setRoomPasswordError] = useState<string | null>(null);
  const [roomVoiceEnabled, setRoomVoiceEnabled] = useState(false);
  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [stageSize, setStageSize] = useState({ width: 960, height: 520 });
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
  const clipboardRef = useRef<ShapeOperation[]>([]);
  const lastCanvasPointRef = useRef<{ x: number; y: number } | null>(null);
  const stageRef = useRef<HTMLElement | null>(null);
  const hlcRef = useRef<HybridLogicalClock | null>(null);
  const lastCursorSentAt = useRef(0);
  const lastShapePreviewSentAt = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const restoringRef = useRef(false);
  const bufferedOpsRef = useRef<ShapeOperation[]>([]);
  const pendingOpsRef = useRef<ShapeOperation[]>([]);
  const localAudioStreamRef = useRef<MediaStream | null>(null);
  const restoreGenerationRef = useRef(0);
  const connectionGenerationRef = useRef(0);
  const setRoomId = useConnectionStore((state) => state.setRoomId);
  const setStatus = useConnectionStore((state) => state.setStatus);
  const setClient = useConnectionStore((state) => state.setClient);
  const status = useConnectionStore((state) => state.status);
  const wsClient = useConnectionStore((state) => state.wsClient);
  const userId = useUserStore((state) => state.userId);
  const displayName = useUserStore((state) => state.displayName);
  const color = useUserStore((state) => state.color);
  const setPeers = useUserStore((state) => state.setPeers);
  const addPeer = useUserStore((state) => state.addPeer);
  const removePeer = useUserStore((state) => state.removePeer);
  const updateCursor = useUserStore((state) => state.updateCursor);
  const remoteCount = useUserStore((state) => Object.keys(state.remotes).length);
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

  const verifyRoomAccess = useCallback(async (password?: string) => {
    if (!roomId) {
      setRoomAccessState('missing');
      return null;
    }

    setRoomAccessState('checking');
    setRoomPasswordError(null);
    const room = await getRoom(roomId, password || undefined);
    if (!room.exists) {
      setRoomAccessState('missing');
      return room;
    }

    setRoomName(room.name);
    setRoomVoiceEnabled(room.voiceEnabled);
    if (!room.authorized) {
      setRoomWsUrl('');
      setRoomAccessState('password');
      return room;
    }

    setRoomWsUrl(room.wsUrl);
    setRoomAccessState('ready');
    return room;
  }, [roomId]);

  const restoreLatestState = useCallback(async () => {
    const history = await getRoomHistory(roomId, Date.now());
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
    setPreviewPositions((current) => {
      if (!current[op.shapeId]) {
        return current;
      }

      const next = { ...current };
      delete next[op.shapeId];
      return next;
    });
    setPenPreviews((current) => {
      if (!current[op.shapeId]) {
        return current;
      }

      const next = { ...current };
      delete next[op.shapeId];
      return next;
    });

    if (restoringRef.current) {
      bufferedOpsRef.current.push(op);
      return;
    }

    applyOp(op);
  }, [applyOp]);

  if (!hlcRef.current) {
    hlcRef.current = new HybridLogicalClock(userId);
  }

  const stampOp = useCallback((op: ShapeOperation): ShapeOperation => {
    const hlc = op.hlc ?? hlcRef.current?.now() ?? `${Date.now()}.0.${userId}`;
    return { ...op, opId: op.opId ?? msgId(), hlc, writerId: userId };
  }, [userId]);

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

  const flushPendingOps = useCallback((client: WSClient) => {
    const pendingOps = pendingOpsRef.current;
    pendingOpsRef.current = [];
    pendingOps.forEach((op) => {
      applyOp(op);
      sendStampedOp(client, op);
    });
    return pendingOps.length;
  }, [applyOp, sendStampedOp]);

  const queuePendingOp = useCallback((op: ShapeOperation) => {
    if (op.opType !== 'update') {
      pendingOpsRef.current.push(op);
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
      return pendingOpsRef.current.length;
    }

    pendingOpsRef.current.push(op);
    return pendingOpsRef.current.length;
  }, []);

  const sendShapeOp = useCallback((op: ShapeOperation) => {
    const stampedOp = stampOp(op);
    applyOp(stampedOp);
    if (status !== 'connected' || !wsClient) {
      const pendingCount = queuePendingOp(stampedOp);
      setEvents((current) => [`queued offline op: ${pendingCount}`, ...current].slice(0, 5));
      return;
    }

    sendStampedOp(wsClient, stampedOp);
  }, [applyOp, queuePendingOp, sendStampedOp, stampOp, status, wsClient]);

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
    if (!roomId || roomAccessState !== 'ready' || !roomWsUrl) {
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
          restoringRef.current = true;
          bufferedOpsRef.current = [];
          connectedClient?.sendJson({
            type: 'join',
            msgId: msgId(),
            roomId,
            userId,
            displayName,
            color,
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
          return;
        }

        if (message.type === 'peer-left') {
          removePeer(message.userId);
          setEvents((current) => [`${message.userId.slice(0, 8)} left`, ...current].slice(0, 5));
          return;
        }

        if (message.type === 'cursor') {
          updateCursor(message.userId, message.x, message.y, message.displayName, message.color);
          return;
        }

        if (message.type === 'op') {
          applyRemoteOp(message);
          return;
        }

        if (message.type === 'shape-preview') {
          const { points, stroke, strokeWidth, x, y } = message.op.attrs ?? {};
          if (message.op.shapeType === 'pen' && Array.isArray(points) && points.length >= 4) {
            setPenPreviews((current) => ({
              ...current,
              [message.op.shapeId]: {
                points,
                stroke: typeof stroke === 'string' ? stroke : undefined,
                strokeWidth: typeof strokeWidth === 'number' ? strokeWidth : undefined,
              },
            }));
            return;
          }

          if (typeof x === 'number' && typeof y === 'number') {
            setPreviewPositions((current) => ({
              ...current,
              [message.op.shapeId]: { x, y },
            }));
          }
          return;
        }

        if (message.type === 'error') {
          setEvents((current) => [`error: ${message.message}`, ...current].slice(0, 5));
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
      setClient(null);
      setRoomId(null);
    };
  }, [addPeer, applyOp, applyRemoteOp, color, displayName, fitViewportToContent, flushPendingOps, removePeer, replayBufferedOps, restoreLatestState, roomAccessState, roomId, roomWsUrl, setClient, setPeers, setRoomId, setStatus, updateCursor, userId]);

  useEffect(() => {
    const element = stageRef.current;
    if (!element) {
      return;
    }

    const updateStageSize = () => {
      setStageSize({
        width: element.clientWidth,
        height: element.clientHeight,
      });
    };

    updateStageSize();
    const observer = new ResizeObserver(updateStageSize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    const point = toRelativePoint(event);
    const canvasPoint = screenToCanvasPoint(point);
    lastCanvasPointRef.current = canvasPoint;
    const now = Date.now();
    if (now - lastCursorSentAt.current < cursorIntervalMs || status !== 'connected') {
      return;
    }

    lastCursorSentAt.current = now;
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

    shapesToDelete.forEach((shape) => {
      sendShapeOp({
        opType: 'delete',
        shapeId: shape.id,
        shapeType: shape.type,
      });
    });
    setActiveGroupId(null);
  }, [selectedShape, selectedShapes, sendShapeOp]);

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
        const existingIndex = nextIds.indexOf(shapeId);
        if (existingIndex >= 0) {
          nextIds.splice(existingIndex, 1);
        } else {
          nextIds.push(shapeId);
        }
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
    const stampedOp = stampOp(op);
    setPreviewPositions((current) => {
      if (!current[stampedOp.shapeId]) {
        return current;
      }

      const next = { ...current };
      delete next[stampedOp.shapeId];
      return next;
    });
    applyOp(stampedOp);

    if (status !== 'connected' || !wsClient) {
      const pendingCount = queuePendingOp(stampedOp);
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
    ops.forEach(sendShapeOp);
    window.requestAnimationFrame(fitViewportToContent);
    setEvents((current) => [`inserted template: ${templateId}`, ...current].slice(0, 5));
  }, [fitViewportToContent, sendShapeOp]);

  const handleTemplateInsert = (templateId: ProductTemplateId) => {
    const center = viewportCenter();
    insertTemplateAt(templateId, { x: center.x - 420, y: center.y - 220 });
  };

  const activeMeetingPhase = phases.find((phase) => phase.id === activePhaseId) ?? phases[0] ?? meetingPhases[0];

  const handlePhaseChange = (phaseId: MeetingPhaseId) => {
    setActivePhaseId(phaseId);
    const phase = phases.find((item) => item.id === phaseId);
    if (phase) {
      setEvents((current) => [`meeting phase: ${phase.label}`, ...current].slice(0, 5));
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

  const handleAddPhase = () => {
    const phase: MeetingPhase = {
      id: `custom-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      label: '自定义阶段',
      hint: '写下这个阶段希望团队完成的事情。',
      templateId: 'kanban',
    };
    setPhases((current) => [...current, phase]);
    setActivePhaseId(phase.id);
  };

  const handleRemovePhase = (phaseId: MeetingPhaseId) => {
    setPhases((current) => {
      if (current.length <= 1) {
        return current;
      }

      const index = current.findIndex((phase) => phase.id === phaseId);
      const next = current.filter((phase) => phase.id !== phaseId);
      if (activePhaseId === phaseId) {
        setActivePhaseId(next[Math.max(0, index - 1)]?.id ?? next[0].id);
      }
      return next;
    });
  };

  const handleUpdatePhase = (phaseId: MeetingPhaseId, patch: Partial<MeetingPhase>) => {
    setPhases((current) => current.map((phase) => (
      phase.id === phaseId ? { ...phase, ...patch, id: phase.id } : phase
    )));
  };

  const handleImportFile = async (file: File) => {
    try {
      const contents = await file.text();
      const center = viewportCenter();
      const result = createImportOps(file.name, contents, center.x - 420, center.y - 220);
      result.ops.forEach(sendShapeOp);
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

    clipboardRef.current.forEach((item, index) => {
      const shapeId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `paste-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`;
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
  }, [sendShapeOp]);

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

  const moveSelected = useCallback((dx: number, dy: number, duplicateBeforeMove = false) => {
    const shapesToMove = shapesForSelection();
    if (shapesToMove.length === 0) {
      return;
    }

    if (duplicateBeforeMove) {
      duplicateSelected(0);
    }

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
  }, [duplicateSelected, sendShapeOp, shapesForSelection]);

  const groupSelected = useCallback(() => {
    const shapesToGroup = shapesForSelection();
    if (shapesToGroup.length < 2) {
      return;
    }

    const groupId = typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `group-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    shapesToGroup.forEach((shape) => {
      sendShapeOp({
        opType: 'update',
        shapeId: shape.id,
        shapeType: shape.type,
        attrs: { groupId, groupName: 'Group' },
      });
    });
    setActiveGroupId(groupId);
  }, [sendShapeOp, shapesForSelection]);

  const ungroupSelected = useCallback(() => {
    const shapesToUngroup = shapesForSelection();
    shapesToUngroup.forEach((shape) => {
      sendShapeOp({
        opType: 'update',
        shapeId: shape.id,
        shapeType: shape.type,
        attrs: { groupId: null, groupName: null },
      });
    });
    setActiveGroupId(null);
  }, [sendShapeOp, shapesForSelection]);

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
      if (isModifier && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        copySelected();
        return;
      }

      if (isModifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        duplicateSelected();
        return;
      }

      if (isModifier && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteClipboard(event.shiftKey ? 12 : 36, lastCanvasPointRef.current ?? undefined);
        return;
      }

      if (isModifier && event.key.toLowerCase() === 'g') {
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

      const key = event.key.toLowerCase();
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
  }, [copySelected, duplicateSelected, groupSelected, handleDeleteSelected, moveSelected, pasteClipboard, selectedIds.length, selectedShape, ungroupSelected]);

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

  const handleLoadHistory = async () => {
    setHistoryLoading(true);
    try {
      const history = await getRoomHistory(roomId, historyAt);
      const appliedOps = applyHistoryState(history);
      window.requestAnimationFrame(fitViewportToContent);
      setEvents((current) => [`history loaded: ${appliedOps} ops`, ...current].slice(0, 5));
    } catch (err) {
      setEvents((current) => [`history error: ${err instanceof Error ? err.message : 'unknown'}`, ...current].slice(0, 5));
    } finally {
      setHistoryLoading(false);
    }
  };

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
    <main className="whiteboard-shell">
      <header className="whiteboard-topbar">
        <div>
          <Link to="/" className="back-link"><ArrowLeft size={15} aria-hidden /> Home</Link>
          <h1>{roomName || 'Cocanvas board'}</h1>
          <p>Room {roomId}</p>
        </div>
        <UserIdentityEditor compact />
        <div className="room-stats">
          <span>WS: <strong>{status}</strong></span>
          <span>Peers: <strong>{remoteCount}</strong></span>
          <span>Tool: <strong>{activeTool}</strong></span>
        </div>
        {roomVoiceEnabled && (
          <div className="meeting-strip">
            <AudioLines size={16} aria-hidden />
            <span>{micEnabled ? '麦克风已开启' : '会议语音待加入'}</span>
            <button type="button" onClick={() => void toggleMicrophone()}>
              {micEnabled ? <MicOff size={15} aria-hidden /> : <Mic size={15} aria-hidden />}
              <span>{micEnabled ? '静音' : '加入语音'}</span>
            </button>
            {micError && <em>{micError}</em>}
          </div>
        )}
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
        onDragOver={(event) => {
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
        }}
        onDrop={handleToolDrop}
        onContextMenu={(event) => {
          event.preventDefault();
          setContextMenu({ x: event.clientX, y: event.clientY });
        }}
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
        <div className="board-help">
          <strong>{activeMeetingPhase.label}: {activeMeetingPhase.hint}</strong>
          <span>{activeTool === 'hand' ? 'Drag to pan' : 'Drag tools from the left or click canvas to create'} · Ctrl/Cmd click multi-select · Ctrl/Cmd+/ shortcuts</span>
        </div>
        <div className="zoom-controls" aria-label="Zoom controls">
          <button type="button" title="Keyboard shortcuts" onClick={() => setShortcutsOpen(true)}><Keyboard size={16} aria-hidden /></button>
          <button type="button" title="Zoom out" onClick={() => zoomBy(0.9)}><ZoomOut size={16} aria-hidden /></button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" title="Zoom in" onClick={() => zoomBy(1.1)}><ZoomIn size={16} aria-hidden /></button>
          <button type="button" title="Fit to content" onClick={fitViewport}><AlignCenter size={16} aria-hidden /></button>
          <button type="button" title="Export PNG" onClick={exportPng}><ImageDown size={16} aria-hidden /></button>
        </div>
      </section>

      <section className="timeline-panel compact-history">
        <label htmlFor="history-at">History timestamp</label>
        <input
          id="history-at"
          type="number"
          value={historyAt}
          onChange={(event) => setHistoryAt(Number(event.target.value))}
        />
        <button type="button" onClick={handleLoadHistory} disabled={historyLoading}>
          {historyLoading ? <Download size={16} aria-hidden /> : <History size={16} aria-hidden />}
          <span>{historyLoading ? 'Loading' : 'Load'}</span>
        </button>
      </section>

      <ol className="room-events" aria-label="Room events">
        {events.map((event, index) => (
          <li key={`${event}-${index}`}>{event}</li>
        ))}
      </ol>

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
              <div><kbd>Ctrl/Cmd C</kbd><span>Copy selection</span></div>
              <div><kbd>Ctrl/Cmd V</kbd><span>Paste selection</span></div>
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

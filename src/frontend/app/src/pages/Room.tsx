import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CanvasBoard, type ViewportState } from '../components/CanvasBoard';
import { CursorLayer } from '../components/CursorLayer';
import { ProductPanel } from '../components/ProductPanel';
import { Toolbar, type ToolMode } from '../components/Toolbar';
import { HybridLogicalClock } from '../crdt/hlc';
import { getRoom, getRoomHistory, type HistoryResponse } from '../network/api';
import { WSClient } from '../network/websocket';
import { useConnectionStore } from '../store/connectionStore';
import { useShapeStore, type CanvasShape } from '../store/shapeStore';
import { useUserStore } from '../store/userStore';
import type { ServerMessage, ShapeOperation } from '../types/protocol';
import {
  cardPalette,
  createCardOp,
  createTemplateOps,
  downloadTextFile,
  exportMarkdown,
  shapeText,
  shapeToExportRecord,
  type ProductTemplateId,
} from '../whiteboard/productBoard';

const cursorIntervalMs = 50;
const shapePreviewIntervalMs = 16;
const reconnectDelays = [1000, 2000, 4000, 8000, 15000];
const stickyColors = ['#ffd966', '#9fc5e8', '#b6d7a8', '#ead1dc', '#f9cb9c', '#d9d2e9', '#b7e1cd', '#ffffff'];
const strokeColors = ['#111827', '#334155', '#1d4ed8', '#047857', '#b45309', '#be123c', '#6d28d9', '#ffffff'];

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
  const [events, setEvents] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(() => Date.now());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 960, height: 520 });
  const [activeTool, setActiveTool] = useState<ToolMode>('select');
  const [viewport, setViewport] = useState<ViewportState>({ scale: 1, x: 0, y: 0 });
  const [previewPositions, setPreviewPositions] = useState<Record<string, { x: number; y: number }>>({});
  const [penPreviews, setPenPreviews] = useState<Record<string, { points: number[]; stroke?: string; strokeWidth?: number }>>({});
  const [productQuery, setProductQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [tagFilter, setTagFilter] = useState('all');
  const clipboardRef = useRef<ShapeOperation[]>([]);
  const stageRef = useRef<HTMLElement | null>(null);
  const hlcRef = useRef<HybridLogicalClock | null>(null);
  const lastCursorSentAt = useRef(0);
  const lastShapePreviewSentAt = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const restoringRef = useRef(false);
  const bufferedOpsRef = useRef<ShapeOperation[]>([]);
  const pendingOpsRef = useRef<ShapeOperation[]>([]);
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
    if (!roomId) {
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
      const room = await getRoom(roomId);
      if (!active || !room.exists || connectionGenerationRef.current !== connectionGeneration) {
        return;
      }

      const url = resolveWsUrl(room.wsUrl);
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
  }, [addPeer, applyOp, applyRemoteOp, color, displayName, fitViewportToContent, flushPendingOps, removePeer, replayBufferedOps, restoreLatestState, roomId, setClient, setPeers, setRoomId, setStatus, updateCursor, userId]);

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
    const now = Date.now();
    if (now - lastCursorSentAt.current < cursorIntervalMs || status !== 'connected') {
      return;
    }

    const point = toRelativePoint(event);
    lastCursorSentAt.current = now;
    wsClient?.sendJson({
      type: 'cursor',
      msgId: msgId(),
      roomId,
      userId,
      x: point.x,
      y: point.y,
    });
  };

  const handleToolSelect = (tool: ToolMode) => {
    setActiveTool(tool);
  };

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
  }, [selectedShape, selectedShapes, sendShapeOp]);

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

  const handleStyleChange = (attrs: ShapeOperation['attrs']) => {
    const shapesToUpdate = selectedShapes.length > 0 ? selectedShapes : selectedShape ? [selectedShape] : [];
    if (shapesToUpdate.length === 0) {
      return;
    }

    shapesToUpdate.forEach((shape) => {
      sendShapeOp({
        opType: 'update',
        shapeId: shape.id,
        shapeType: shape.type,
        attrs,
      });
    });
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

  const handleTemplateInsert = (templateId: ProductTemplateId) => {
    const center = viewportCenter();
    const ops = createTemplateOps(templateId, center.x - 420, center.y - 220);
    ops.forEach(sendShapeOp);
    window.requestAnimationFrame(fitViewportToContent);
    setEvents((current) => [`inserted template: ${templateId}`, ...current].slice(0, 5));
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

  const handleTextInsideChange = () => {
    if (!selectedShape || selectedShape.type === 'text' || selectedShape.type === 'sticky' || selectedShape.type === 'connector') {
      return;
    }

    const text = window.prompt('Shape text', selectedShape.attrs.text ?? '');
    if (text === null) {
      return;
    }

    handleStyleChange({ text });
  };

  const handleLayerChange = (direction: 'front' | 'back' | 'forward' | 'backward') => {
    if (!selectedShape) {
      return;
    }

    const shapes = Object.values(useShapeStore.getState().shapes);
    const zValues = shapes.map((shape) => shape.attrs.zIndex ?? 0);
    const current = selectedShape.attrs.zIndex ?? 0;
    const maxZ = Math.max(0, ...zValues);
    const minZ = Math.min(0, ...zValues);
    const nextZ = direction === 'front'
      ? maxZ + 1
      : direction === 'back'
        ? minZ - 1
        : direction === 'forward'
          ? current + 1
          : current - 1;

    handleStyleChange({ zIndex: nextZ });
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
    const shapesToCopy = selectedShapes.length > 0 ? selectedShapes : selectedShape ? [selectedShape] : [];
    clipboardRef.current = shapesToCopy.map((shape) => ({
      opType: 'create',
      shapeId: shape.id,
      shapeType: shape.type,
      attrs: { ...shape.attrs },
    }));
    if (shapesToCopy.length > 0) {
      setEvents((current) => [`copied ${shapesToCopy.length} item(s)`, ...current].slice(0, 5));
    }
  }, [selectedShape, selectedShapes]);

  const pasteClipboard = useCallback(() => {
    if (clipboardRef.current.length === 0) {
      return;
    }

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
          x: (item.attrs?.x ?? 0) + 36,
          y: (item.attrs?.y ?? 0) + 36,
          zIndex: Date.now() + index,
        },
      });
    });
  }, [sendShapeOp]);

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

      if (isModifier && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        pasteClipboard();
        return;
      }

      if (event.key === 'Escape') {
        setActiveTool('select');
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
  }, [copySelected, handleDeleteSelected, pasteClipboard, selectedIds.length, selectedShape]);

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

  return (
    <main className="whiteboard-shell">
      <header className="whiteboard-topbar">
        <div>
          <Link to="/" className="back-link">← Home</Link>
          <h1>Cocanvas board</h1>
          <p>Room {roomId} · <strong style={{ color }}>{displayName}</strong></p>
        </div>
        <div className="room-stats">
          <span>WS: <strong>{status}</strong></span>
          <span>Peers: <strong>{remoteCount}</strong></span>
          <span>Tool: <strong>{activeTool}</strong></span>
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
        query={productQuery}
        statusFilter={statusFilter}
        tagFilter={tagFilter}
        onQueryChange={setProductQuery}
        onStatusFilterChange={setStatusFilter}
        onTagFilterChange={setTagFilter}
        onCreateCard={handleCreateCard}
        onTemplateInsert={handleTemplateInsert}
        onUpdateSelected={handleProductUpdate}
        onVoteSelected={handleVoteSelected}
        onExportMarkdown={exportProductMarkdown}
        onExportJson={exportProductJson}
      />

      {selectedShape && (
        <section className="context-toolbar" aria-label="Selection styles">
          <span>{selectedIds.length > 1 ? `${selectedIds.length} items` : selectedShape.type}</span>
          <div className="swatches" aria-label="Fill color">
            {stickyColors.map((fill) => (
              <button
                key={fill}
                type="button"
                title={fill}
                style={{ background: fill }}
                onClick={() => handleStyleChange({
                  fill,
                  textColor: fill === '#ffffff' || fill === '#ffd966' ? '#202124' : '#111827',
                })}
              />
            ))}
          </div>
          <div className="swatches" aria-label="Stroke color">
            {strokeColors.map((stroke) => (
              <button
                key={stroke}
                type="button"
                title={`Stroke ${stroke}`}
                style={{ background: stroke }}
                onClick={() => handleStyleChange({ stroke })}
              />
            ))}
          </div>
          <button type="button" onClick={() => handleStyleChange({ strokeWidth: Math.max(0, (selectedShape.attrs.strokeWidth ?? 2) - 1) })}>S-</button>
          <button type="button" onClick={() => handleStyleChange({ strokeWidth: Math.min(8, (selectedShape.attrs.strokeWidth ?? 2) + 1) })}>S+</button>
          <button type="button" onClick={() => handleStyleChange({ fontSize: Math.max(14, (selectedShape.attrs.fontSize ?? 22) - 2) })}>A-</button>
          <button type="button" onClick={() => handleStyleChange({ fontSize: Math.min(48, (selectedShape.attrs.fontSize ?? 22) + 2) })}>A+</button>
          <button type="button" onClick={handleTextInsideChange} disabled={selectedShape.type === 'text' || selectedShape.type === 'sticky' || selectedShape.type === 'connector' || selectedShape.type === 'pen'}>Text</button>
          {selectedShape.type === 'comment' && (
            <button type="button" onClick={() => handleStyleChange({ resolved: !selectedShape.attrs.resolved })}>
              {selectedShape.attrs.resolved ? 'Open' : 'Done'}
            </button>
          )}
          <button type="button" onClick={() => handleLayerChange('front')}>Front</button>
          <button type="button" onClick={() => handleLayerChange('back')}>Back</button>
          <button type="button" onClick={handleDeleteSelected}>Delete</button>
        </section>
      )}

      <section className="canvas-stage whiteboard-canvas" ref={stageRef} onMouseMove={handleMouseMove}>
        <CanvasBoard
          width={stageSize.width}
          height={stageSize.height}
          activeTool={activeTool}
          viewport={viewport}
          previewPositions={previewPositions}
          penPreviews={penPreviews}
          visibleShapeIds={visibleShapeIds}
          onViewportChange={setViewport}
          onShapePreview={handleShapePreview}
          onShapeCommit={handleShapeCommit}
          onCreateShape={(op) => {
            sendShapeOp(op);
            setActiveTool('select');
          }}
        />
        <CursorLayer />
        <div className="board-help">
          <strong>{activeTool === 'hand' ? 'Drag to pan' : 'Double-click sticky/text to edit'}</strong>
          <span>Wheel to zoom · V select · H hand · N sticky · K card</span>
        </div>
        <div className="zoom-controls" aria-label="Zoom controls">
          <button type="button" onClick={() => zoomBy(0.9)}>-</button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.1)}>+</button>
          <button type="button" onClick={fitViewport}>Fit</button>
          <button type="button" onClick={exportPng}>PNG</button>
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
          {historyLoading ? 'Loading...' : 'Load history'}
        </button>
      </section>

      <ol className="room-events" aria-label="Room events">
        {events.map((event, index) => (
          <li key={`${event}-${index}`}>{event}</li>
        ))}
      </ol>
    </main>
  );
}

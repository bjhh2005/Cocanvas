import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CanvasBoard, type ViewportState } from '../components/CanvasBoard';
import { CursorLayer } from '../components/CursorLayer';
import { Toolbar, type ToolMode } from '../components/Toolbar';
import { HybridLogicalClock } from '../crdt/hlc';
import { getRoom, getRoomHistory, type HistoryResponse } from '../network/api';
import { WSClient } from '../network/websocket';
import { useConnectionStore } from '../store/connectionStore';
import { useShapeStore } from '../store/shapeStore';
import { useUserStore } from '../store/userStore';
import type { ServerMessage, ShapeOperation } from '../types/protocol';

const cursorIntervalMs = 50;
const reconnectDelays = [1000, 2000, 4000, 8000, 15000];
const stickyColors = ['#ffd966', '#9fc5e8', '#b6d7a8', '#ead1dc', '#f9cb9c', '#d9d2e9', '#b7e1cd', '#ffffff'];

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
  const stageRef = useRef<HTMLElement | null>(null);
  const hlcRef = useRef<HybridLogicalClock | null>(null);
  const lastCursorSentAt = useRef(0);
  const lastShapeSentAt = useRef(0);
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
  const selectedId = useShapeStore((state) => state.selectedId);
  const selectedShape = useShapeStore((state) => selectedId ? state.shapes[selectedId] : null);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.tagName === 'TEXTAREA' || target?.tagName === 'INPUT') {
        return;
      }

      if (event.key === 'Escape') {
        setActiveTool('select');
      }

      if (event.key.toLowerCase() === 'v') {
        setActiveTool('select');
      }

      if (event.key.toLowerCase() === 'h') {
        setActiveTool('hand');
      }

      if (event.key.toLowerCase() === 'n') {
        setActiveTool('sticky');
      }

      if (event.key.toLowerCase() === 't') {
        setActiveTool('text');
      }

      if (event.key !== 'Delete' && event.key !== 'Backspace') {
        return;
      }

      if (!selectedShape) {
        return;
      }

      event.preventDefault();
      sendShapeOp({
        opType: 'delete',
        shapeId: selectedShape.id,
        shapeType: selectedShape.type,
      });
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedShape, sendShapeOp]);

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

  const handleDeleteSelected = () => {
    if (!selectedShape) {
      return;
    }

    sendShapeOp({
      opType: 'delete',
      shapeId: selectedShape.id,
      shapeType: selectedShape.type,
    });
  };

  const handleShapeMove = (op: ShapeOperation) => {
    const stampedOp = stampOp(op);
    applyOp(stampedOp);

    const now = Date.now();
    if (now - lastShapeSentAt.current < cursorIntervalMs) {
      return;
    }

    lastShapeSentAt.current = now;
    if (status !== 'connected' || !wsClient) {
      const pendingCount = queuePendingOp(stampedOp);
      setEvents((current) => [`queued offline op: ${pendingCount}`, ...current].slice(0, 5));
      return;
    }

    sendStampedOp(wsClient, stampedOp);
  };

  const handleStyleChange = (attrs: ShapeOperation['attrs']) => {
    if (!selectedShape) {
      return;
    }

    sendShapeOp({
      opType: 'update',
      shapeId: selectedShape.id,
      shapeType: selectedShape.type,
      attrs,
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
    setViewport({ scale: 1, x: 0, y: 0 });
  };

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

      {selectedShape && (
        <section className="context-toolbar" aria-label="Selection styles">
          <span>{selectedShape.type}</span>
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
          <button type="button" onClick={() => handleStyleChange({ fontSize: Math.max(14, (selectedShape.attrs.fontSize ?? 22) - 2) })}>A-</button>
          <button type="button" onClick={() => handleStyleChange({ fontSize: Math.min(48, (selectedShape.attrs.fontSize ?? 22) + 2) })}>A+</button>
          <button type="button" onClick={handleDeleteSelected}>Delete</button>
        </section>
      )}

      <section className="canvas-stage whiteboard-canvas" ref={stageRef} onMouseMove={handleMouseMove}>
        <CanvasBoard
          width={stageSize.width}
          height={stageSize.height}
          activeTool={activeTool}
          viewport={viewport}
          onViewportChange={setViewport}
          onShapeOp={handleShapeMove}
          onCreateShape={(op) => {
            sendShapeOp(op);
            setActiveTool('select');
          }}
        />
        <CursorLayer />
        <div className="board-help">
          <strong>{activeTool === 'hand' ? 'Drag to pan' : 'Double-click sticky/text to edit'}</strong>
          <span>Wheel to zoom · V select · H hand · N sticky · T text</span>
        </div>
        <div className="zoom-controls" aria-label="Zoom controls">
          <button type="button" onClick={() => zoomBy(0.9)}>-</button>
          <span>{Math.round(viewport.scale * 100)}%</span>
          <button type="button" onClick={() => zoomBy(1.1)}>+</button>
          <button type="button" onClick={fitViewport}>Fit</button>
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

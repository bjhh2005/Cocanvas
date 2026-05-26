import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CanvasBoard } from '../components/CanvasBoard';
import { CursorLayer } from '../components/CursorLayer';
import { createShapeOp, Toolbar } from '../components/Toolbar';
import { HybridLogicalClock } from '../crdt/hlc';
import { getRoom, getRoomHistory, type HistoryResponse } from '../network/api';
import { WSClient } from '../network/websocket';
import { useConnectionStore } from '../store/connectionStore';
import { useShapeStore } from '../store/shapeStore';
import { useUserStore } from '../store/userStore';
import type { ServerMessage, ShapeOperation, ShapeType } from '../types/protocol';

const cursorIntervalMs = 50;
const reconnectDelays = [1000, 2000, 4000, 8000, 15000];

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

export function Room() {
  const { roomId = '' } = useParams();
  const [events, setEvents] = useState<string[]>([]);
  const [historyAt, setHistoryAt] = useState(() => Date.now());
  const [historyLoading, setHistoryLoading] = useState(false);
  const [stageSize, setStageSize] = useState({ width: 960, height: 520 });
  const stageRef = useRef<HTMLElement | null>(null);
  const hlcRef = useRef<HybridLogicalClock | null>(null);
  const lastCursorSentAt = useRef(0);
  const lastShapeSentAt = useRef(0);
  const reconnectAttemptRef = useRef(0);
  const restoringRef = useRef(false);
  const bufferedOpsRef = useRef<ShapeOperation[]>([]);
  const restoreGenerationRef = useRef(0);
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

  const stampOp = (op: ShapeOperation): ShapeOperation => {
    const hlc = hlcRef.current?.now() ?? `${Date.now()}.0.${userId}`;
    return { ...op, hlc, writerId: userId };
  };

  const sendShapeOp = (op: ShapeOperation) => {
    const stampedOp = stampOp(op);
    applyOp(stampedOp);
    if (status !== 'connected') {
      return;
    }

    wsClient?.sendJson({
      type: 'op',
      msgId: msgId(),
      roomId,
      userId,
      hlc: stampedOp.hlc ?? '',
      op: stampedOp,
    });
  };

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
      setRoomId(roomId);
      const room = await getRoom(roomId);
      if (!active || !room.exists) {
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
                restoreGenerationRef.current !== restoreGeneration
              ) {
                return;
              }

              const replayedOps = replayBufferedOps();
              setEvents((current) => [
                `state restored: ${restoredOps} ops, replayed ${replayedOps}`,
                ...current,
              ].slice(0, 5));
            })
            .catch((err) => {
              if (
                !active ||
                client !== connectedClient ||
                connectedClient?.getStatus() !== 'connected' ||
                restoreGenerationRef.current !== restoreGeneration
              ) {
                return;
              }

              const replayedOps = replayBufferedOps();
              setEvents((current) => [
                `restore failed: ${err instanceof Error ? err.message : 'unknown'}, replayed ${replayedOps}`,
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
      setClient(null);
      setRoomId(null);
    };
  }, [addPeer, applyOp, applyRemoteOp, color, displayName, removePeer, replayBufferedOps, restoreLatestState, roomId, setClient, setPeers, setRoomId, setStatus, updateCursor, userId]);

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
  }, [selectedShape, roomId, status, userId, wsClient]);

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

  const handleCreateShape = (shapeType: ShapeType) => {
    const centerX = Math.max(80, Math.round(stageSize.width / 2 - 70 + Math.random() * 60));
    const centerY = Math.max(80, Math.round(stageSize.height / 2 - 45 + Math.random() * 60));
    sendShapeOp(createShapeOp(shapeType, centerX, centerY));
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
    if (now - lastShapeSentAt.current < cursorIntervalMs || status !== 'connected') {
      return;
    }

    lastShapeSentAt.current = now;
    wsClient?.sendJson({
      type: 'op',
      msgId: msgId(),
      roomId,
      userId,
      hlc: stampedOp.hlc ?? '',
      op: stampedOp,
    });
  };

  const handleLoadHistory = async () => {
    setHistoryLoading(true);
    try {
      const history = await getRoomHistory(roomId, historyAt);
      const appliedOps = applyHistoryState(history);
      setEvents((current) => [`history loaded: ${appliedOps} ops`, ...current].slice(0, 5));
    } catch (err) {
      setEvents((current) => [`history error: ${err instanceof Error ? err.message : 'unknown'}`, ...current].slice(0, 5));
    } finally {
      setHistoryLoading(false);
    }
  };

  return (
    <main className="room-shell">
      <header className="room-header">
        <div>
          <Link to="/" className="back-link">← Home</Link>
          <h1>Room {roomId}</h1>
          <p>你是 <strong style={{ color }}>{displayName}</strong>，移动鼠标即可广播光标。</p>
        </div>
        <div className="room-stats">
          <span>WS: <strong>{status}</strong></span>
          <span>Peers: <strong>{remoteCount}</strong></span>
        </div>
      </header>

      <Toolbar
        selectedId={selectedId}
        onCreateShape={handleCreateShape}
        onDeleteSelected={handleDeleteSelected}
      />

      <section className="timeline-panel">
        <label htmlFor="history-at">Time travel timestamp</label>
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

      <section className="canvas-stage" ref={stageRef} onMouseMove={handleMouseMove}>
        <CanvasBoard width={stageSize.width} height={stageSize.height} onShapeOp={handleShapeMove} />
        <CursorLayer />
        <div className="canvas-hint">
          <strong>Mouse broadcast zone</strong>
          <span>打开第二个窗口进入同一 roomId，添加或拖动图形会同步给对方。</span>
        </div>
      </section>

      <ol className="room-events" aria-label="Room events">
        {events.map((event, index) => (
          <li key={`${event}-${index}`}>{event}</li>
        ))}
      </ol>
    </main>
  );
}

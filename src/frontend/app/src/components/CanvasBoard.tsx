import { Arrow, Circle, Group, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import type { ToolMode } from './Toolbar';
import { useShapeStore, type CanvasShape } from '../store/shapeStore';
import type { ShapeOperation } from '../types/protocol';
import { priorityLabels, statusLabels } from '../whiteboard/productBoard';
import { createShapeOp, uniqueId } from '../whiteboard/shapeFactory';

export type ViewportState = {
  scale: number;
  x: number;
  y: number;
};

type CanvasBoardProps = {
  width: number;
  height: number;
  activeTool: ToolMode;
  viewport: ViewportState;
  previewPositions: Record<string, { x: number; y: number }>;
  penPreviews: Record<string, { points: number[]; stroke?: string; strokeWidth?: number }>;
  onViewportChange: (viewport: ViewportState) => void;
  onShapePreview: (op: ShapeOperation) => void;
  onShapeCommit: (op: ShapeOperation) => void;
  onCreateShape: (op: ShapeOperation) => void;
  visibleShapeIds?: Set<string> | null;
};

type EditingState = {
  shape: CanvasShape;
  left: number;
  top: number;
  width: number;
  height: number;
  value: string;
};

type DragState = {
  shapeId: string;
  shapeType: CanvasShape['type'];
  offsetX: number;
  offsetY: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  moved: boolean;
  selectedIds: string[];
  startPositions: Record<string, { x: number; y: number; shapeType: CanvasShape['type'] }>;
};

type AnchorName = 'top' | 'right' | 'bottom' | 'left' | 'center';

type ConnectorDraft = {
  fromShapeId: string;
  fromAnchor: AnchorName;
  x: number;
  y: number;
  targetShapeId?: string;
  targetAnchor?: AnchorName;
};

type ShapeBounds = {
  left: number;
  top: number;
  width: number;
  height: number;
};

type SelectionBox = {
  startX: number;
  startY: number;
  x: number;
  y: number;
};

type PenDraft = {
  shapeId: string;
  points: number[];
};

type FrameDraft = SelectionBox;

const minScale = 0.35;
const maxScale = 2.4;

export function CanvasBoard({
  width,
  height,
  activeTool,
  viewport,
  previewPositions,
  penPreviews,
  onViewportChange,
  onShapePreview,
  onShapeCommit,
  onCreateShape,
  visibleShapeIds,
}: CanvasBoardProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const shapeMap = useShapeStore((state) => state.shapes);
  const shapes = useMemo(
    () => Object.values(shapeMap).sort((a, b) => (a.attrs.zIndex ?? 0) - (b.attrs.zIndex ?? 0)),
    [shapeMap]
  );
  const connectors = useMemo(() => shapes.filter((shape) => shape.type === 'connector'), [shapes]);
  const boardShapes = useMemo(() => shapes.filter((shape) => shape.type !== 'connector'), [shapes]);
  const selectedId = useShapeStore((state) => state.selectedId);
  const selectedIds = useShapeStore((state) => state.selectedIds);
  const setSelectedId = useShapeStore((state) => state.setSelectedId);
  const setSelectedIds = useShapeStore((state) => state.setSelectedIds);
  const toggleSelectedId = useShapeStore((state) => state.toggleSelectedId);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [penDraft, setPenDraft] = useState<PenDraft | null>(null);
  const [frameDraft, setFrameDraft] = useState<FrameDraft | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (activeTool !== 'hand') {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      dragStateRef.current = null;
      setDragState(null);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTool]);

  const screenToCanvas = (point: { x: number; y: number }) => ({
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  });

  const pointFromStage = () => {
    const pointer = stageRef.current?.getPointerPosition();
    return pointer ? screenToCanvas(pointer) : null;
  };

  const renderedBoardShapes = useMemo(
    () => boardShapes.map((shape) => {
      const startPosition = dragState?.startPositions[shape.id];
      if (startPosition) {
        return {
          ...shape,
          attrs: {
            ...shape.attrs,
            x: startPosition.x + dragState.dx,
            y: startPosition.y + dragState.dy,
          },
        };
      }

      const previewPosition = previewPositions[shape.id];
      if (previewPosition) {
        return { ...shape, attrs: { ...shape.attrs, ...previewPosition } };
      }

      return shape;
    }),
    [boardShapes, dragState, previewPositions]
  );

  const renderedShapesById = useMemo(
    () => Object.fromEntries([...connectors, ...renderedBoardShapes].map((shape) => [shape.id, shape])),
    [connectors, renderedBoardShapes]
  );

  const createAtPointer = () => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }

    const point = screenToCanvas(pointer);
    const shapeType = activeTool === 'sticky' ||
      activeTool === 'card' ||
      activeTool === 'text' ||
      activeTool === 'circle' ||
      activeTool === 'roundedRect' ||
      activeTool === 'diamond' ||
      activeTool === 'triangle'
      ? activeTool
      : 'rect';
    onCreateShape(createShapeOp(shapeType, Math.round(point.x), Math.round(point.y)));
  };

  const handleWheel = (event: Konva.KonvaEventObject<WheelEvent>) => {
    event.evt.preventDefault();
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }

    const scaleBy = 1.06;
    const oldScale = viewport.scale;
    const pointerBeforeZoom = screenToCanvas(pointer);
    const nextScale = Math.min(maxScale, Math.max(minScale, event.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy));

    onViewportChange({
      scale: nextScale,
      x: pointer.x - pointerBeforeZoom.x * nextScale,
      y: pointer.y - pointerBeforeZoom.y * nextScale,
    });
  };

  const handleStageMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    if (event.target !== event.target.getStage()) {
      return;
    }

    setSelectedId(null);
    const point = pointFromStage();
    if (!point) {
      return;
    }

    if (activeTool === 'select') {
      setSelectedId(null);
      setSelectionBox({ startX: point.x, startY: point.y, x: point.x, y: point.y });
      return;
    }

    if (activeTool === 'pen') {
      setSelectedId(null);
      const shapeId = uniqueId('pen');
      setPenDraft({ shapeId, points: [Math.round(point.x), Math.round(point.y)] });
      return;
    }

    if (activeTool === 'frame') {
      setSelectedId(null);
      setFrameDraft({ startX: point.x, startY: point.y, x: point.x, y: point.y });
      return;
    }

    if (activeTool === 'comment') {
      const text = window.prompt('Comment', 'Comment');
      if (text !== null) {
        const op = createShapeOp('comment', Math.round(point.x), Math.round(point.y));
        onCreateShape({ ...op, attrs: { ...op.attrs, text, authorName: undefined, authorId: undefined } });
      }
      return;
    }

    if (
      activeTool === 'sticky' ||
      activeTool === 'card' ||
      activeTool === 'text' ||
      activeTool === 'rect' ||
      activeTool === 'roundedRect' ||
      activeTool === 'circle' ||
      activeTool === 'diamond' ||
      activeTool === 'triangle'
    ) {
      createAtPointer();
    }
  };

  const beginShapeDrag = (shape: CanvasShape, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (activeTool === 'hand' || activeTool === 'connector' || activeTool === 'pen' || activeTool === 'comment' || activeTool === 'frame') {
      return;
    }

    event.cancelBubble = true;
    const point = pointFromStage();
    if (!point) {
      return;
    }

    const isShiftClick = 'shiftKey' in event.evt && event.evt.shiftKey;
    if (isShiftClick) {
      return;
    }

    const nextSelectedIds = selectedIds.includes(shape.id) ? selectedIds : [shape.id];
    const startPositions = Object.fromEntries(
      nextSelectedIds
        .map((shapeId) => renderedShapesById[shapeId])
        .filter((selectedShape): selectedShape is CanvasShape => Boolean(selectedShape))
        .map((selectedShape) => [
          selectedShape.id,
          { x: selectedShape.attrs.x, y: selectedShape.attrs.y, shapeType: selectedShape.type },
        ])
    );

    const nextDragState = {
      shapeId: shape.id,
      shapeType: shape.type,
      offsetX: point.x - shape.attrs.x,
      offsetY: point.y - shape.attrs.y,
      x: shape.attrs.x,
      y: shape.attrs.y,
      dx: 0,
      dy: 0,
      moved: false,
      selectedIds: nextSelectedIds,
      startPositions,
    };

    setSelectedIds(nextSelectedIds);
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  };

  const updateShapeDrag = () => {
    const point = pointFromStage();

    if (connectorDraft) {
      if (point) {
        const target = findConnectorTarget(point);
        setConnectorDraft((current) => current ? {
          ...current,
          x: point.x,
          y: point.y,
          targetShapeId: target?.shape.id,
          targetAnchor: target?.anchor,
        } : current);
      }
      return;
    }

    if (selectionBox) {
      if (point) {
        setSelectionBox((current) => current ? { ...current, x: point.x, y: point.y } : current);
      }
      return;
    }

    if (penDraft) {
      if (point) {
        const lastX = penDraft.points[penDraft.points.length - 2];
        const lastY = penDraft.points[penDraft.points.length - 1];
        if (Math.hypot(point.x - lastX, point.y - lastY) < 2 / viewport.scale) {
          return;
        }

        const nextDraft = {
          ...penDraft,
          points: [...penDraft.points, Math.round(point.x), Math.round(point.y)],
        };
        setPenDraft(nextDraft);
        onShapePreview({
          opType: 'update',
          shapeId: nextDraft.shapeId,
          shapeType: 'pen',
          attrs: {
            x: 0,
            y: 0,
            points: nextDraft.points,
            fill: 'transparent',
            stroke: '#111827',
            strokeWidth: 3,
          },
        });
      }
      return;
    }

    if (frameDraft) {
      if (point) {
        setFrameDraft((current) => current ? { ...current, x: point.x, y: point.y } : current);
      }
      return;
    }

    const current = dragStateRef.current;
    if (!current) {
      return;
    }

    if (!point) {
      return;
    }

    const x = Math.round(point.x - current.offsetX);
    const y = Math.round(point.y - current.offsetY);
    if (x === current.x && y === current.y) {
      return;
    }

    const nextDragState = {
      ...current,
      x,
      y,
      dx: x - (current.startPositions[current.shapeId]?.x ?? current.x),
      dy: y - (current.startPositions[current.shapeId]?.y ?? current.y),
      moved: true,
    };

    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
    onShapePreview({
      opType: 'update',
      shapeId: current.shapeId,
      shapeType: current.shapeType,
      attrs: { x, y },
    });
  };

  const commitShapeDrag = () => {
    if (connectorDraft) {
      const point = pointFromStage();
      if (point) {
        const target = findConnectorTarget(point);
        if (target) {
          createConnector(connectorDraft, target.shape, target.anchor);
        }
      }

      setConnectorDraft(null);
      return;
    }

    if (selectionBox) {
      const bounds = normalizedBounds(selectionBox);
      const nextSelectedIds = renderedBoardShapes
        .filter((shape) => shape.type !== 'frame')
        .filter((shape) => boundsIntersect(bounds, shapeBounds(shape)))
        .map((shape) => shape.id);
      setSelectedIds(nextSelectedIds);
      setSelectionBox(null);
      return;
    }

    if (penDraft) {
      if (penDraft.points.length >= 4) {
        onCreateShape({
          opType: 'create',
          shapeId: penDraft.shapeId,
          shapeType: 'pen',
          attrs: {
            x: 0,
            y: 0,
            points: penDraft.points,
            fill: 'transparent',
            stroke: '#111827',
            strokeWidth: 3,
            zIndex: penDraft.points[0] ?? 0,
          },
        });
      }
      setPenDraft(null);
      return;
    }

    if (frameDraft) {
      const bounds = normalizedBounds(frameDraft);
      if (bounds.width > 24 && bounds.height > 24) {
        const op = createShapeOp('frame', Math.round(bounds.left), Math.round(bounds.top));
        onCreateShape({
          ...op,
          attrs: {
            ...op.attrs,
            w: Math.round(bounds.width),
            h: Math.round(bounds.height),
          },
        });
      }
      setFrameDraft(null);
      return;
    }

    const current = dragStateRef.current;
    if (!current) {
      return;
    }

    if (current.moved) {
      current.selectedIds.forEach((shapeId) => {
        const startPosition = current.startPositions[shapeId];
        if (!startPosition) {
          return;
        }

        onShapeCommit({
          opType: 'update',
          shapeId,
          shapeType: startPosition.shapeType,
          attrs: {
            x: Math.round(startPosition.x + current.dx),
            y: Math.round(startPosition.y + current.dy),
          },
        });
      });
    }

    dragStateRef.current = null;
    setDragState(null);
  };

  const shapeBounds = (shape: CanvasShape): ShapeBounds => {
    if (shape.type === 'pen' && shape.attrs.points && shape.attrs.points.length >= 2) {
      const xs = shape.attrs.points.filter((_, index) => index % 2 === 0);
      const ys = shape.attrs.points.filter((_, index) => index % 2 === 1);
      const minX = Math.min(...xs) + shape.attrs.x;
      const minY = Math.min(...ys) + shape.attrs.y;
      const maxX = Math.max(...xs) + shape.attrs.x;
      const maxY = Math.max(...ys) + shape.attrs.y;
      return { left: minX, top: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
    }

    const width = shape.attrs.w ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 140);
    const height = shape.attrs.h ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 90);
    if (shape.type === 'circle') {
      return {
        left: shape.attrs.x - width / 2,
        top: shape.attrs.y - height / 2,
        width,
        height,
      };
    }

    return { left: shape.attrs.x, top: shape.attrs.y, width, height };
  };

  const normalizedBounds = (box: SelectionBox): ShapeBounds => ({
    left: Math.min(box.startX, box.x),
    top: Math.min(box.startY, box.y),
    width: Math.abs(box.x - box.startX),
    height: Math.abs(box.y - box.startY),
  });

  const boundsIntersect = (left: ShapeBounds, right: ShapeBounds) => (
    left.left <= right.left + right.width &&
    left.left + left.width >= right.left &&
    left.top <= right.top + right.height &&
    left.top + left.height >= right.top
  );

  const anchorPoint = (shape: CanvasShape, anchor: AnchorName = 'center') => {
    const bounds = shapeBounds(shape);
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    if (anchor === 'top') {
      return { x: centerX, y: bounds.top };
    }
    if (anchor === 'right') {
      return { x: bounds.left + bounds.width, y: centerY };
    }
    if (anchor === 'bottom') {
      return { x: centerX, y: bounds.top + bounds.height };
    }
    if (anchor === 'left') {
      return { x: bounds.left, y: centerY };
    }
    return { x: centerX, y: centerY };
  };

  const connectorPoints = (connector: CanvasShape) => {
    const fromShape = connector.attrs.fromShapeId ? renderedShapesById[connector.attrs.fromShapeId] : null;
    const toShape = connector.attrs.toShapeId ? renderedShapesById[connector.attrs.toShapeId] : null;
    if (!fromShape || !toShape) {
      return null;
    }

    const from = anchorPoint(fromShape, connector.attrs.fromAnchor);
    const to = anchorPoint(toShape, connector.attrs.toAnchor);
    return [from.x, from.y, to.x, to.y];
  };

  const beginConnectorDraft = (shape: CanvasShape, anchor: AnchorName, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    event.cancelBubble = true;
    const point = anchorPoint(shape, anchor);
    setConnectorDraft({
      fromShapeId: shape.id,
      fromAnchor: anchor,
      x: point.x,
      y: point.y,
    });
  };

  const nearestAnchorForPoint = (shape: CanvasShape, point: { x: number; y: number }): AnchorName => {
    const anchors: AnchorName[] = ['top', 'right', 'bottom', 'left'];
    return anchors.reduce((nearest, anchor) => {
      const nearestPoint = anchorPoint(shape, nearest);
      const currentPoint = anchorPoint(shape, anchor);
      const nearestDistance = Math.hypot(nearestPoint.x - point.x, nearestPoint.y - point.y);
      const currentDistance = Math.hypot(currentPoint.x - point.x, currentPoint.y - point.y);
      return currentDistance < nearestDistance ? anchor : nearest;
    }, 'top' as AnchorName);
  };

  const pointDistanceToBounds = (point: { x: number; y: number }, bounds: ShapeBounds) => {
    const dx = Math.max(bounds.left - point.x, 0, point.x - (bounds.left + bounds.width));
    const dy = Math.max(bounds.top - point.y, 0, point.y - (bounds.top + bounds.height));
    return Math.hypot(dx, dy);
  };

  const createConnector = (draft: ConnectorDraft, targetShape: CanvasShape, anchor: AnchorName) => {
    if (draft.fromShapeId === targetShape.id) {
      return;
    }

    const from = renderedShapesById[draft.fromShapeId];
    if (!from) {
      return;
    }

    const fromPoint = anchorPoint(from, draft.fromAnchor);
    onCreateShape({
      opType: 'create',
      shapeId: uniqueId('connector'),
      shapeType: 'connector',
      attrs: {
        x: fromPoint.x,
        y: fromPoint.y,
        fromShapeId: draft.fromShapeId,
        toShapeId: targetShape.id,
        fromAnchor: draft.fromAnchor,
        toAnchor: anchor,
        stroke: '#334155',
        strokeWidth: 2,
        fill: 'transparent',
        arrowEnd: true,
        zIndex: -1,
      },
    });
  };

  const findConnectorTarget = (point: { x: number; y: number }): { shape: CanvasShape; anchor: AnchorName } | null => {
    const threshold = 36 / viewport.scale;
    const candidates: Array<{ shape: CanvasShape; anchor: AnchorName; distance: number }> = [];

    renderedBoardShapes.forEach((shape) => {
      if (connectorDraft?.fromShapeId === shape.id) {
        return;
      }

      const distance = pointDistanceToBounds(point, shapeBounds(shape));
      if (distance <= threshold) {
        candidates.push({
          shape,
          anchor: nearestAnchorForPoint(shape, point),
          distance,
        });
      }
    });

    const nearest = candidates.sort((left, right) => left.distance - right.distance)[0];
    return nearest ? { shape: nearest.shape, anchor: nearest.anchor } : null;
  };

  const beginEdit = (shape: CanvasShape) => {
    if (shape.type !== 'text' && shape.type !== 'sticky' && shape.type !== 'comment' && shape.type !== 'frame' && shape.type !== 'card') {
      return;
    }

    setSelectedId(shape.id);
    setEditing({
      shape,
      left: viewport.x + shape.attrs.x * viewport.scale,
      top: viewport.y + shape.attrs.y * viewport.scale,
      width: (shape.attrs.w ?? (shape.type === 'text' ? 260 : 190)) * viewport.scale,
      height: (shape.attrs.h ?? (shape.type === 'text' ? 72 : shape.type === 'comment' ? 86 : shape.type === 'card' ? 168 : 170)) * viewport.scale,
      value: shape.type === 'card'
        ? [shape.attrs.title, shape.attrs.body].filter(Boolean).join('\n\n')
        : shape.attrs.text ?? '',
    });
  };

  const commitEdit = () => {
    if (!editing) {
      return;
    }

    onShapeCommit({
      opType: 'update',
      shapeId: editing.shape.id,
      shapeType: editing.shape.type,
      attrs: editing.shape.type === 'card'
        ? {
          title: editing.value.split(/\n\s*\n/)[0] ?? '',
          body: editing.value.split(/\n\s*\n/).slice(1).join('\n\n'),
        }
        : { text: editing.value },
    });
    setEditing(null);
  };

  return (
    <>
      <Stage
        ref={stageRef}
        width={width}
        height={height}
        x={viewport.x}
        y={viewport.y}
        scaleX={viewport.scale}
        scaleY={viewport.scale}
        draggable={activeTool === 'hand'}
        onDragEnd={(event) => onViewportChange({ ...viewport, x: event.target.x(), y: event.target.y() })}
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={updateShapeDrag}
        onMouseUp={commitShapeDrag}
        onMouseLeave={commitShapeDrag}
        onTouchMove={updateShapeDrag}
        onTouchEnd={commitShapeDrag}
      >
        <Layer>
          {connectors.map((connector) => {
            const points = connectorPoints(connector);
            if (!points) {
              return null;
            }

            return (
              <Arrow
                key={connector.id}
                points={points}
                stroke={connector.attrs.stroke}
                fill={connector.attrs.stroke}
                strokeWidth={connector.attrs.strokeWidth}
                pointerLength={connector.attrs.arrowEnd === false ? 0 : 10}
                pointerWidth={connector.attrs.arrowEnd === false ? 0 : 10}
                hitStrokeWidth={12}
                onClick={() => setSelectedId(connector.id)}
                onTap={() => setSelectedId(connector.id)}
              />
            );
          })}
          {connectorDraft && (() => {
            const from = renderedShapesById[connectorDraft.fromShapeId];
            if (!from) {
              return null;
            }

            const start = anchorPoint(from, connectorDraft.fromAnchor);
            return (
              <Arrow
                points={[start.x, start.y, connectorDraft.x, connectorDraft.y]}
                stroke="#64748b"
                fill="#64748b"
                strokeWidth={2}
                dash={[7, 5]}
                pointerLength={10}
                pointerWidth={10}
              />
            );
          })()}
          {penDraft && (
            <Line
              points={penDraft.points}
              stroke="#111827"
              strokeWidth={3}
              lineCap="round"
              lineJoin="round"
              tension={0.35}
            />
          )}
          {Object.entries(penPreviews).map(([shapeId, preview]) => (
            <Line
              key={shapeId}
              points={preview.points}
              stroke={preview.stroke ?? '#111827'}
              strokeWidth={preview.strokeWidth ?? 3}
              lineCap="round"
              lineJoin="round"
              tension={0.35}
              opacity={0.72}
              listening={false}
            />
          ))}
          {selectionBox && (() => {
            const box = normalizedBounds(selectionBox);
            return (
              <Rect
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                fill="rgba(37, 99, 235, 0.08)"
                stroke="#2563eb"
                strokeWidth={1}
                dash={[6, 4]}
              />
            );
          })()}
          {frameDraft && (() => {
            const box = normalizedBounds(frameDraft);
            return (
              <Rect
                x={box.left}
                y={box.top}
                width={box.width}
                height={box.height}
                fill="rgba(255, 255, 255, 0.02)"
                stroke="#64748b"
                strokeWidth={2}
                dash={[10, 6]}
              />
            );
          })()}
          {renderedBoardShapes.map((shape) => {
            return (
              <ShapeNode
                key={shape.id}
                shape={shape}
                selected={selectedIds.includes(shape.id)}
                editable={shape.type === 'text' || shape.type === 'sticky' || shape.type === 'comment' || shape.type === 'frame' || shape.type === 'card'}
                dimmed={visibleShapeIds ? !visibleShapeIds.has(shape.id) : false}
                onSelect={(event) => {
                  if ('shiftKey' in event.evt && event.evt.shiftKey) {
                    toggleSelectedId(shape.id);
                    return;
                  }

                  setSelectedId(shape.id);
                }}
                onEdit={() => beginEdit(shape)}
                onMoveStart={(event) => beginShapeDrag(shape, event)}
                onAnchorStart={(anchor, event) => beginConnectorDraft(shape, anchor, event)}
                showAnchors={
                  (activeTool === 'connector' && shape.id === selectedId) ||
                  connectorDraft?.targetShapeId === shape.id
                }
                highlightedAnchor={connectorDraft?.targetShapeId === shape.id ? connectorDraft.targetAnchor : undefined}
              />
            );
          })}
        </Layer>
      </Stage>

      {editing && (
        <textarea
          className={editing.shape.type === 'sticky' || editing.shape.type === 'card' ? 'inline-editor sticky-editor' : 'inline-editor text-editor'}
          value={editing.value}
          autoFocus
          style={{
            left: editing.left,
            top: editing.top,
            width: editing.width,
            minHeight: editing.height,
            fontSize: (editing.shape.attrs.fontSize ?? 22) * viewport.scale,
            color: editing.shape.attrs.textColor ?? editing.shape.attrs.fill,
            background: editing.shape.type === 'sticky' || editing.shape.type === 'card' ? editing.shape.attrs.fill : 'white',
          }}
          onChange={(event) => setEditing({ ...editing, value: event.target.value })}
          onBlur={commitEdit}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              commitEdit();
            }
            if (event.key === 'Escape') {
              setEditing(null);
            }
          }}
        />
      )}
    </>
  );
}

type ShapeNodeProps = {
  shape: CanvasShape;
  selected: boolean;
  editable: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onEdit: () => void;
  onMoveStart: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onAnchorStart: (anchor: AnchorName, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  showAnchors: boolean;
  highlightedAnchor?: AnchorName;
  dimmed?: boolean;
};

function ShapeNode({
  shape,
  selected,
  editable,
  onSelect,
  onEdit,
  onMoveStart,
  onAnchorStart,
  showAnchors,
  highlightedAnchor,
  dimmed = false,
}: ShapeNodeProps) {
  const common = {
    x: shape.attrs.x,
    y: shape.attrs.y,
    draggable: false,
    onClick: onSelect,
    onTap: onSelect,
    onDblClick: editable ? onEdit : undefined,
    onDblTap: editable ? onEdit : undefined,
    onMouseDown: onMoveStart,
    onTouchStart: onMoveStart,
    opacity: dimmed ? 0.22 : 1,
  };

  const stroke = shape.attrs.stroke;
  const strokeWidth = shape.attrs.strokeWidth;

  const anchorLayer = showAnchors ? (
    <AnchorHandles shape={shape} onAnchorStart={onAnchorStart} highlightedAnchor={highlightedAnchor} />
  ) : null;

  const selectionOutline = (width: number, height: number, offsetX = 0, offsetY = 0, radius = 4) => selected ? (
    <Rect
      x={offsetX - 5}
      y={offsetY - 5}
      width={width + 10}
      height={height + 10}
      stroke="#1f6feb"
      strokeWidth={2}
      dash={[6, 4]}
      cornerRadius={radius}
      listening={false}
    />
  ) : null;

  if (shape.type === 'pen') {
    return (
      <Line
        points={shape.attrs.points ?? []}
        x={shape.attrs.x}
        y={shape.attrs.y}
        stroke={stroke}
        strokeWidth={strokeWidth}
        lineCap="round"
        lineJoin="round"
        tension={0.35}
        hitStrokeWidth={14}
        onClick={onSelect}
        onTap={onSelect}
        onMouseDown={onMoveStart}
        onTouchStart={onMoveStart}
      />
    );
  }

  if (shape.type === 'frame') {
    const width = shape.attrs.w ?? 520;
    const height = shape.attrs.h ?? 320;
    return (
      <Group {...common}>
        <Rect
          width={width}
          height={height}
          fill={shape.attrs.fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          dash={[12, 7]}
          cornerRadius={4}
        />
        <Text
          text={shape.attrs.text ?? 'Frame'}
          x={12}
          y={-30}
          width={Math.max(120, width - 24)}
          height={26}
          fontSize={shape.attrs.fontSize ?? 20}
          fontStyle="bold"
          fill={shape.attrs.textColor ?? '#475569'}
        />
        {selectionOutline(width, height)}
        {anchorLayer}
      </Group>
    );
  }

  if (shape.type === 'comment') {
    const width = shape.attrs.w ?? 220;
    const height = shape.attrs.h ?? 86;
    const resolved = shape.attrs.resolved === true;
    return (
      <Group {...common} opacity={resolved ? 0.62 : 1}>
        <Rect
          width={width}
          height={height}
          fill={shape.attrs.fill}
          stroke={resolved ? '#94a3b8' : stroke}
          strokeWidth={strokeWidth}
          cornerRadius={shape.attrs.cornerRadius ?? 8}
          shadowColor="rgba(15, 23, 42, 0.18)"
          shadowBlur={selected ? 14 : 8}
          shadowOffsetY={3}
          shadowOpacity={0.18}
        />
        <Circle x={18} y={18} radius={8} fill={resolved ? '#94a3b8' : '#f59e0b'} />
        <Text
          text={shape.attrs.text ?? 'Comment'}
          x={34}
          y={11}
          width={width - 46}
          height={height - 18}
          fontSize={shape.attrs.fontSize ?? 16}
          fill={shape.attrs.textColor ?? '#111827'}
          lineHeight={1.22}
        />
        {selectionOutline(width, height, 0, 0, shape.attrs.cornerRadius ?? 8)}
        {anchorLayer}
      </Group>
    );
  }

  if (shape.type === 'circle') {
    const radius = shape.attrs.radius ?? 48;
    const diameter = radius * 2;
    return (
      <Group {...common}>
        <Circle
          radius={radius}
          fill={shape.attrs.fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="rgba(15, 23, 42, 0.18)"
          shadowBlur={selected ? 16 : 8}
          shadowOpacity={0.28}
          draggable={false}
          onClick={onSelect}
          onTap={onSelect}
          onMouseDown={onMoveStart}
          onTouchStart={onMoveStart}
        />
        {shape.attrs.text && (
          <Text
            text={shape.attrs.text}
            x={-radius}
            y={-radius}
            width={diameter}
            height={diameter}
            align="center"
            verticalAlign="middle"
            fontSize={shape.attrs.fontSize ?? 18}
            fill={shape.attrs.textColor ?? '#111827'}
            listening={false}
          />
        )}
        {selectionOutline(diameter, diameter, -radius, -radius, radius)}
        {anchorLayer}
      </Group>
    );
  }

  if (shape.type === 'sticky') {
    const width = shape.attrs.w ?? 190;
    const height = shape.attrs.h ?? 170;
    return (
      <Group {...common}>
        <Rect
          width={width}
          height={height}
          fill={shape.attrs.fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          cornerRadius={shape.attrs.cornerRadius ?? 10}
          shadowColor="rgba(15, 23, 42, 0.22)"
          shadowBlur={selected ? 18 : 10}
          shadowOffsetY={4}
          shadowOpacity={0.22}
        />
        <Text
          text={shape.attrs.text ?? 'Add idea'}
          width={width}
          height={height}
          padding={16}
          fontSize={shape.attrs.fontSize ?? 22}
          fill={shape.attrs.textColor ?? '#202124'}
          lineHeight={1.16}
        />
        {selectionOutline(width, height, 0, 0, shape.attrs.cornerRadius ?? 10)}
        {anchorLayer}
      </Group>
    );
  }

  if (shape.type === 'card') {
    const width = shape.attrs.w ?? 260;
    const height = shape.attrs.h ?? 168;
    const tags = shape.attrs.tags ?? [];
    const priority = shape.attrs.priority ?? 'medium';
    const status = shape.attrs.status ?? 'idea';
    const votes = shape.attrs.votes ?? 0;
    return (
      <Group {...common}>
        <Rect
          width={width}
          height={height}
          fill={shape.attrs.fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          cornerRadius={shape.attrs.cornerRadius ?? 8}
          shadowColor="rgba(15, 23, 42, 0.22)"
          shadowBlur={selected ? 18 : 10}
          shadowOffsetY={4}
          shadowOpacity={0.18}
        />
        <Rect
          width={width}
          height={34}
          fill="rgba(255,255,255,0.56)"
          cornerRadius={[8, 8, 0, 0]}
        />
        <Text
          text={statusLabels[status]}
          x={14}
          y={10}
          width={82}
          height={16}
          fontSize={12}
          fontStyle="bold"
          fill="#0f172a"
        />
        <Text
          text={`+${votes}`}
          x={width - 54}
          y={9}
          width={40}
          height={17}
          align="right"
          fontSize={13}
          fontStyle="bold"
          fill="#0f172a"
        />
        <Text
          text={shape.attrs.title ?? 'New idea'}
          x={14}
          y={46}
          width={width - 28}
          height={28}
          fontSize={18}
          fontStyle="bold"
          fill={shape.attrs.textColor ?? '#111827'}
          ellipsis
        />
        <Text
          text={shape.attrs.body ?? ''}
          x={14}
          y={78}
          width={width - 28}
          height={42}
          fontSize={14}
          fill="#334155"
          lineHeight={1.2}
          ellipsis
        />
        {shape.attrs.assignee && (
          <Text
            text={shape.attrs.assignee}
            x={14}
            y={height - 56}
            width={width - 28}
            height={16}
            fontSize={12}
            fill="#64748b"
            ellipsis
          />
        )}
        <Text
          text={tags.slice(0, 3).map((tag) => `#${tag}`).join('  ')}
          x={14}
          y={height - 34}
          width={width - 110}
          height={18}
          fontSize={12}
          fontStyle="bold"
          fill="#475569"
          ellipsis
        />
        <Text
          text={priorityLabels[priority]}
          x={width - 92}
          y={height - 35}
          width={78}
          height={18}
          align="right"
          fontSize={12}
          fontStyle="bold"
          fill="#0f172a"
        />
        {selectionOutline(width, height, 0, 0, shape.attrs.cornerRadius ?? 8)}
        {anchorLayer}
      </Group>
    );
  }

  if (shape.type === 'text') {
    return (
      <Group {...common}>
        <Text
          text={shape.attrs.text ?? 'Text'}
          fontSize={shape.attrs.fontSize ?? 28}
          fontStyle={shape.attrs.fontStyle ?? 'bold'}
          fill={shape.attrs.textColor ?? shape.attrs.fill}
          padding={6}
        />
        {selected && (
          <Rect
            width={(shape.attrs.text?.length ?? 4) * ((shape.attrs.fontSize ?? 28) * 0.65) + 18}
            height={(shape.attrs.fontSize ?? 28) + 20}
            stroke="#1f6feb"
            strokeWidth={2}
            dash={[6, 4]}
          />
        )}
        {anchorLayer}
      </Group>
    );
  }

  if (shape.type === 'diamond') {
    const width = shape.attrs.w ?? 132;
    const height = shape.attrs.h ?? 104;
    return (
      <Group {...common}>
        <Line
          points={[width / 2, 0, width, height / 2, width / 2, height, 0, height / 2]}
          closed
          fill={shape.attrs.fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="rgba(15, 23, 42, 0.18)"
          shadowBlur={selected ? 16 : 8}
          shadowOpacity={0.2}
        />
        {shape.attrs.text && (
          <Text
            text={shape.attrs.text}
            width={width}
            height={height}
            align="center"
            verticalAlign="middle"
            fontSize={shape.attrs.fontSize ?? 18}
            fill={shape.attrs.textColor ?? '#111827'}
          />
        )}
        {selectionOutline(width, height)}
        {anchorLayer}
      </Group>
    );
  }

  if (shape.type === 'triangle') {
    const width = shape.attrs.w ?? 132;
    const height = shape.attrs.h ?? 104;
    return (
      <Group {...common}>
        <RegularPolygon
          x={width / 2}
          y={height / 2 + 4}
          sides={3}
          radius={Math.min(width, height) * 0.56}
          rotation={0}
          fill={shape.attrs.fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          shadowColor="rgba(15, 23, 42, 0.18)"
          shadowBlur={selected ? 16 : 8}
          shadowOpacity={0.2}
        />
        {shape.attrs.text && (
          <Text
            text={shape.attrs.text}
            width={width}
            height={height}
            align="center"
            verticalAlign="middle"
            fontSize={shape.attrs.fontSize ?? 18}
            fill={shape.attrs.textColor ?? '#111827'}
          />
        )}
        {selectionOutline(width, height)}
        {anchorLayer}
      </Group>
    );
  }

  return (
    <Group {...common}>
      <Rect
        width={shape.attrs.w ?? 140}
        height={shape.attrs.h ?? 90}
        fill={shape.attrs.fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        cornerRadius={shape.type === 'roundedRect' ? (shape.attrs.cornerRadius ?? 18) : 0}
        shadowColor="rgba(15, 23, 42, 0.18)"
        shadowBlur={selected ? 16 : 8}
        shadowOpacity={0.2}
      />
      {shape.attrs.text && (
        <Text
          text={shape.attrs.text}
          width={shape.attrs.w ?? 140}
          height={shape.attrs.h ?? 90}
          align="center"
          verticalAlign="middle"
          fontSize={shape.attrs.fontSize ?? 18}
          fill={shape.attrs.textColor ?? '#111827'}
        />
      )}
      {selectionOutline(shape.attrs.w ?? 140, shape.attrs.h ?? 90, 0, 0, shape.type === 'roundedRect' ? (shape.attrs.cornerRadius ?? 18) : 0)}
      {anchorLayer}
    </Group>
  );
}

function AnchorHandles({
  shape,
  onAnchorStart,
  highlightedAnchor,
}: {
  shape: CanvasShape;
  onAnchorStart: (anchor: AnchorName, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  highlightedAnchor?: AnchorName;
}) {
  const width = shape.attrs.w ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 140);
  const height = shape.attrs.h ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 90);
  const left = shape.type === 'circle' ? -(shape.attrs.radius ?? 48) : 0;
  const top = shape.type === 'circle' ? -(shape.attrs.radius ?? 48) : 0;
  const anchors: Array<{ name: AnchorName; x: number; y: number }> = [
    { name: 'top', x: left + width / 2, y: top },
    { name: 'right', x: left + width, y: top + height / 2 },
    { name: 'bottom', x: left + width / 2, y: top + height },
    { name: 'left', x: left, y: top + height / 2 },
  ];

  return (
    <Group>
      {anchors.map((anchor) => (
        <Circle
          key={anchor.name}
          x={anchor.x}
          y={anchor.y}
          radius={highlightedAnchor === anchor.name ? 8 : 6}
          fill={highlightedAnchor === anchor.name ? '#2563eb' : '#ffffff'}
          stroke="#2563eb"
          strokeWidth={2}
          onMouseDown={(event) => onAnchorStart(anchor.name, event)}
          onTouchStart={(event) => onAnchorStart(anchor.name, event)}
        />
      ))}
    </Group>
  );
}

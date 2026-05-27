import { Arrow, Circle, Group, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva';
import { useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { createShapeOp, type ToolMode } from './Toolbar';
import { useShapeStore, type CanvasShape } from '../store/shapeStore';
import type { ShapeOperation } from '../types/protocol';

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
  onViewportChange: (viewport: ViewportState) => void;
  onShapePreview: (op: ShapeOperation) => void;
  onShapeCommit: (op: ShapeOperation) => void;
  onCreateShape: (op: ShapeOperation) => void;
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
  moved: boolean;
};

type AnchorName = 'top' | 'right' | 'bottom' | 'left' | 'center';

type ConnectorDraft = {
  fromShapeId: string;
  fromAnchor: AnchorName;
  x: number;
  y: number;
};

const minScale = 0.35;
const maxScale = 2.4;

export function CanvasBoard({
  width,
  height,
  activeTool,
  viewport,
  previewPositions,
  onViewportChange,
  onShapePreview,
  onShapeCommit,
  onCreateShape,
}: CanvasBoardProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const shapeMap = useShapeStore((state) => state.shapes);
  const shapes = useMemo(
    () => Object.values(shapeMap).sort((a, b) => (a.attrs.zIndex ?? 0) - (b.attrs.zIndex ?? 0)),
    [shapeMap]
  );
  const shapesById = useMemo(() => Object.fromEntries(shapes.map((shape) => [shape.id, shape])), [shapes]);
  const connectors = useMemo(() => shapes.filter((shape) => shape.type === 'connector'), [shapes]);
  const boardShapes = useMemo(() => shapes.filter((shape) => shape.type !== 'connector'), [shapes]);
  const selectedId = useShapeStore((state) => state.selectedId);
  const setSelectedId = useShapeStore((state) => state.setSelectedId);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft | null>(null);
  const dragStateRef = useRef<DragState | null>(null);

  useEffect(() => {
    if (activeTool === 'hand') {
      dragStateRef.current = null;
      setDragState(null);
    }
  }, [activeTool]);

  const screenToCanvas = (point: { x: number; y: number }) => ({
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  });

  const createAtPointer = () => {
    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }

    const point = screenToCanvas(pointer);
    const shapeType = activeTool === 'sticky' ||
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
    if (
      activeTool === 'sticky' ||
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
    if (activeTool === 'hand' || activeTool === 'connector') {
      return;
    }

    event.cancelBubble = true;
    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) {
      return;
    }

    const point = screenToCanvas(pointer);
    const nextDragState = {
      shapeId: shape.id,
      shapeType: shape.type,
      offsetX: point.x - shape.attrs.x,
      offsetY: point.y - shape.attrs.y,
      x: shape.attrs.x,
      y: shape.attrs.y,
      moved: false,
    };

    setSelectedId(shape.id);
    dragStateRef.current = nextDragState;
    setDragState(nextDragState);
  };

  const updateShapeDrag = () => {
    if (connectorDraft) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        const point = screenToCanvas(pointer);
        setConnectorDraft((current) => current ? { ...current, x: point.x, y: point.y } : current);
      }
      return;
    }

    const current = dragStateRef.current;
    if (!current) {
      return;
    }

    const pointer = stageRef.current?.getPointerPosition();
    if (!pointer) {
      return;
    }

    const point = screenToCanvas(pointer);
    const x = Math.round(point.x - current.offsetX);
    const y = Math.round(point.y - current.offsetY);
    if (x === current.x && y === current.y) {
      return;
    }

    const nextDragState = {
      ...current,
      x,
      y,
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
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        const point = screenToCanvas(pointer);
        const target = findConnectorTarget(point);
        if (target) {
          createConnector(connectorDraft, target.shape, target.anchor);
        }
      }

      setConnectorDraft(null);
      return;
    }

    const current = dragStateRef.current;
    if (!current) {
      return;
    }

    if (current.moved) {
      onShapeCommit({
        opType: 'update',
        shapeId: current.shapeId,
        shapeType: current.shapeType,
        attrs: { x: current.x, y: current.y },
      });
    }

    dragStateRef.current = null;
    setDragState(null);
  };

  const shapeBounds = (shape: CanvasShape) => {
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
    const fromShape = connector.attrs.fromShapeId ? shapesById[connector.attrs.fromShapeId] : null;
    const toShape = connector.attrs.toShapeId ? shapesById[connector.attrs.toShapeId] : null;
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

  const createConnector = (draft: ConnectorDraft, targetShape: CanvasShape, anchor: AnchorName) => {
    if (draft.fromShapeId === targetShape.id) {
      return;
    }

    const from = shapesById[draft.fromShapeId];
    if (!from) {
      return;
    }

    const fromPoint = anchorPoint(from, draft.fromAnchor);
    onCreateShape({
      opType: 'create',
      shapeId: typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `connector-${Date.now()}-${Math.random().toString(16).slice(2)}`,
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
    const threshold = 28 / viewport.scale;
    const candidates: Array<{ shape: CanvasShape; anchor: AnchorName; distance: number }> = [];

    boardShapes.forEach((shape) => {
      if (connectorDraft?.fromShapeId === shape.id) {
        return;
      }

      (['top', 'right', 'bottom', 'left'] as AnchorName[]).forEach((anchor) => {
        const anchorPosition = anchorPoint(shape, anchor);
        const distance = Math.hypot(anchorPosition.x - point.x, anchorPosition.y - point.y);
        if (distance <= threshold) {
          candidates.push({ shape, anchor, distance });
        }
      });
    });

    const nearest = candidates.sort((left, right) => left.distance - right.distance)[0];
    return nearest ? { shape: nearest.shape, anchor: nearest.anchor } : null;
  };

  const beginEdit = (shape: CanvasShape) => {
    if (shape.type !== 'text' && shape.type !== 'sticky') {
      return;
    }

    setSelectedId(shape.id);
    setEditing({
      shape,
      left: viewport.x + shape.attrs.x * viewport.scale,
      top: viewport.y + shape.attrs.y * viewport.scale,
      width: (shape.attrs.w ?? (shape.type === 'text' ? 260 : 190)) * viewport.scale,
      height: (shape.attrs.h ?? (shape.type === 'text' ? 72 : 170)) * viewport.scale,
      value: shape.attrs.text ?? '',
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
      attrs: { text: editing.value },
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
            const from = shapesById[connectorDraft.fromShapeId];
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
          {boardShapes.map((shape) => {
            const previewPosition = previewPositions[shape.id];
            const renderedShape = dragState?.shapeId === shape.id
              ? { ...shape, attrs: { ...shape.attrs, x: dragState.x, y: dragState.y } }
              : previewPosition
                ? { ...shape, attrs: { ...shape.attrs, ...previewPosition } }
              : shape;

            return (
              <ShapeNode
                key={shape.id}
                shape={renderedShape}
                selected={shape.id === selectedId}
                editable={shape.type === 'text' || shape.type === 'sticky'}
                onSelect={() => setSelectedId(shape.id)}
                onEdit={() => beginEdit(shape)}
                onMoveStart={(event) => beginShapeDrag(shape, event)}
                onAnchorStart={(anchor, event) => beginConnectorDraft(shape, anchor, event)}
                showAnchors={activeTool === 'connector' && shape.id === selectedId}
              />
            );
          })}
        </Layer>
      </Stage>

      {editing && (
        <textarea
          className={editing.shape.type === 'sticky' ? 'inline-editor sticky-editor' : 'inline-editor text-editor'}
          value={editing.value}
          autoFocus
          style={{
            left: editing.left,
            top: editing.top,
            width: editing.width,
            minHeight: editing.height,
            fontSize: (editing.shape.attrs.fontSize ?? 22) * viewport.scale,
            color: editing.shape.attrs.textColor ?? editing.shape.attrs.fill,
            background: editing.shape.type === 'sticky' ? editing.shape.attrs.fill : 'white',
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
  onSelect: () => void;
  onEdit: () => void;
  onMoveStart: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onAnchorStart: (anchor: AnchorName, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  showAnchors: boolean;
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
  };

  const stroke = selected ? '#1f6feb' : shape.attrs.stroke;
  const strokeWidth = selected ? Math.max(shape.attrs.strokeWidth ?? 0, 3) : shape.attrs.strokeWidth;

  const anchorLayer = showAnchors ? (
    <AnchorHandles shape={shape} onAnchorStart={onAnchorStart} />
  ) : null;

  if (shape.type === 'circle') {
    return (
      <Group x={shape.attrs.x} y={shape.attrs.y}>
        <Circle
          radius={shape.attrs.radius ?? 48}
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
      {anchorLayer}
    </Group>
  );
}

function AnchorHandles({
  shape,
  onAnchorStart,
}: {
  shape: CanvasShape;
  onAnchorStart: (anchor: AnchorName, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
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
          radius={6}
          fill="#ffffff"
          stroke="#2563eb"
          strokeWidth={2}
          onMouseDown={(event) => onAnchorStart(anchor.name, event)}
          onTouchStart={(event) => onAnchorStart(anchor.name, event)}
        />
      ))}
    </Group>
  );
}

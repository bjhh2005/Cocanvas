import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';
import { useMemo, useRef, useState } from 'react';
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
  onViewportChange: (viewport: ViewportState) => void;
  onShapeOp: (op: ShapeOperation) => void;
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

const minScale = 0.35;
const maxScale = 2.4;

export function CanvasBoard({
  width,
  height,
  activeTool,
  viewport,
  onViewportChange,
  onShapeOp,
  onCreateShape,
}: CanvasBoardProps) {
  const stageRef = useRef<Konva.Stage | null>(null);
  const shapeMap = useShapeStore((state) => state.shapes);
  const shapes = useMemo(() => Object.values(shapeMap), [shapeMap]);
  const selectedId = useShapeStore((state) => state.selectedId);
  const setSelectedId = useShapeStore((state) => state.setSelectedId);
  const [editing, setEditing] = useState<EditingState | null>(null);

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
    const shapeType = activeTool === 'sticky' || activeTool === 'text' || activeTool === 'circle'
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
    if (activeTool === 'sticky' || activeTool === 'text' || activeTool === 'rect' || activeTool === 'circle') {
      createAtPointer();
    }
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

    onShapeOp({
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
      >
        <Layer>
          {shapes.map((shape) => (
            <ShapeNode
              key={shape.id}
              shape={shape}
              selected={shape.id === selectedId}
              editable={shape.type === 'text' || shape.type === 'sticky'}
              draggable={activeTool !== 'hand'}
              onSelect={() => setSelectedId(shape.id)}
              onEdit={() => beginEdit(shape)}
              onMove={(x, y) => onShapeOp({
                opType: 'update',
                shapeId: shape.id,
                shapeType: shape.type,
                attrs: { x, y },
              })}
            />
          ))}
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
  draggable: boolean;
  onSelect: () => void;
  onEdit: () => void;
  onMove: (x: number, y: number) => void;
};

function ShapeNode({ shape, selected, editable, draggable, onSelect, onEdit, onMove }: ShapeNodeProps) {
  const common = {
    x: shape.attrs.x,
    y: shape.attrs.y,
    draggable,
    onClick: onSelect,
    onTap: onSelect,
    onDblClick: editable ? onEdit : undefined,
    onDblTap: editable ? onEdit : undefined,
    onDragMove: (event: Konva.KonvaEventObject<DragEvent>) => {
      onMove(Math.round(event.currentTarget.x()), Math.round(event.currentTarget.y()));
    },
  };

  const stroke = selected ? '#1f6feb' : shape.attrs.stroke;
  const strokeWidth = selected ? Math.max(shape.attrs.strokeWidth ?? 0, 3) : shape.attrs.strokeWidth;

  if (shape.type === 'circle') {
    return (
      <Circle
        {...common}
        radius={shape.attrs.radius ?? 48}
        fill={shape.attrs.fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
        shadowColor="rgba(15, 23, 42, 0.18)"
        shadowBlur={selected ? 16 : 8}
        shadowOpacity={0.28}
      />
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
      </Group>
    );
  }

  return (
    <Rect
      {...common}
      width={shape.attrs.w ?? 140}
      height={shape.attrs.h ?? 90}
      fill={shape.attrs.fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      cornerRadius={shape.attrs.cornerRadius ?? 16}
      shadowColor="rgba(15, 23, 42, 0.18)"
      shadowBlur={selected ? 16 : 8}
      shadowOpacity={0.2}
    />
  );
}

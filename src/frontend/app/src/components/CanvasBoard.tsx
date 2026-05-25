import { Circle, Group, Layer, Rect, Stage, Text } from 'react-konva';
import { useShapeStore, type CanvasShape } from '../store/shapeStore';
import type { ShapeOperation } from '../types/protocol';

type CanvasBoardProps = {
  width: number;
  height: number;
  onShapeOp: (op: ShapeOperation) => void;
};

export function CanvasBoard({ width, height, onShapeOp }: CanvasBoardProps) {
  const shapes = useShapeStore((state) => Object.values(state.shapes));
  const selectedId = useShapeStore((state) => state.selectedId);
  const setSelectedId = useShapeStore((state) => state.setSelectedId);

  return (
    <Stage
      width={width}
      height={height}
      onMouseDown={(event) => {
        if (event.target === event.target.getStage()) {
          setSelectedId(null);
        }
      }}
    >
      <Layer>
        {shapes.map((shape) => (
          <ShapeNode
            key={shape.id}
            shape={shape}
            selected={shape.id === selectedId}
            onSelect={() => setSelectedId(shape.id)}
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
  );
}

type ShapeNodeProps = {
  shape: CanvasShape;
  selected: boolean;
  onSelect: () => void;
  onMove: (x: number, y: number) => void;
};

function ShapeNode({ shape, selected, onSelect, onMove }: ShapeNodeProps) {
  const common = {
    x: shape.attrs.x,
    y: shape.attrs.y,
    draggable: true,
    onClick: onSelect,
    onTap: onSelect,
    onDragMove: (event: { target: { x: () => number; y: () => number } }) => {
      onMove(Math.round(event.target.x()), Math.round(event.target.y()));
    },
  };

  const stroke = selected ? '#ff4d00' : shape.attrs.stroke;
  const strokeWidth = selected ? Math.max(shape.attrs.strokeWidth ?? 0, 4) : shape.attrs.strokeWidth;

  if (shape.type === 'circle') {
    return (
      <Circle
        {...common}
        radius={shape.attrs.radius ?? 48}
        fill={shape.attrs.fill}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    );
  }

  if (shape.type === 'text') {
    return (
      <Group {...common}>
        <Text
          text={shape.attrs.text ?? 'Text'}
          fontSize={26}
          fontStyle="bold"
          fill={shape.attrs.fill}
          padding={6}
        />
        {selected && (
          <Rect
            width={(shape.attrs.text?.length ?? 4) * 17 + 12}
            height={44}
            stroke="#ff4d00"
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
      cornerRadius={16}
    />
  );
}

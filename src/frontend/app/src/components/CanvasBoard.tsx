import { Arrow, Circle, Group, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import type { ToolMode } from './Toolbar';
import type { CanvasBackgroundMode } from '../store/appearanceStore';
import { useShapeStore, type CanvasShape } from '../store/shapeStore';
import type { ShapeOperation } from '../types/protocol';
import { priorityLabels, statusLabels } from '../whiteboard/productBoard';
import { createShapeOp, uniqueId } from '../whiteboard/shapeFactory';

export type ViewportState = {
  scale: number;
  x: number;
  y: number;
};

export type SelectionChangeOptions = {
  source: 'stage' | 'shape' | 'drag' | 'resize' | 'marquee' | 'context' | 'connector';
  additive?: boolean;
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
  onOpenContextMenu?: (position: { x: number; y: number }) => void;
  onSelectionChange?: (shapeIds: string[], options?: SelectionChangeOptions) => string[] | void;
  activeGroupId?: string | null;
  visibleShapeIds?: Set<string> | null;
  backgroundMode?: CanvasBackgroundMode;
  showGridLabels?: boolean;
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
  duplicate: boolean;
  axisLock: boolean;
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

type ResizeDraft = {
  shapeId: string;
  shapeType: CanvasShape['type'];
  startX: number;
  startY: number;
  startW?: number;
  startH?: number;
  startRadius?: number;
  w?: number;
  h?: number;
  radius?: number;
};

type PanDraft = {
  startPointerX: number;
  startPointerY: number;
  startViewport: ViewportState;
  latestViewport: ViewportState;
};

type ZoomDraft = {
  baseViewport: ViewportState;
  latestViewport: ViewportState;
};

type DragLayerState = {
  shapes: CanvasShape[];
};

const minScale = 0.35;
const maxScale = 2.4;
const gridSize = 42;
const viewportOverscan = 520;
const spatialCellSize = 960;
const maxIndexedShapeCells = 80;
const zoomCommitDelayMs = 80;

const shapeBoundsFor = (shape: CanvasShape): ShapeBounds => {
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

const boundsIntersect = (left: ShapeBounds, right: ShapeBounds) => (
  left.left <= right.left + right.width &&
  left.left + left.width >= right.left &&
  left.top <= right.top + right.height &&
  left.top + left.height >= right.top
);

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
  onOpenContextMenu,
  onSelectionChange,
  activeGroupId,
  visibleShapeIds,
  backgroundMode = 'grid',
  showGridLabels = false,
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
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [connectorDraft, setConnectorDraft] = useState<ConnectorDraft | null>(null);
  const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
  const [penDraft, setPenDraft] = useState<PenDraft | null>(null);
  const [frameDraft, setFrameDraft] = useState<FrameDraft | null>(null);
  const [resizeDraft, setResizeDraft] = useState<ResizeDraft | null>(null);
  const [dragLayerState, setDragLayerState] = useState<DragLayerState | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragLayerStateRef = useRef<DragLayerState | null>(null);
  const panDraftRef = useRef<PanDraft | null>(null);
  const zoomDraftRef = useRef<ZoomDraft | null>(null);
  const zoomCommitTimeoutRef = useRef<number | null>(null);
  const imperativeViewportRef = useRef<ViewportState>(viewport);
  // Right-click tracking: contextmenu fires on mousedown on some platforms, so we
  // never open the menu from contextmenu — we open it on mouseup when not moved.
  const rightClickRef = useRef<{ clientX: number; clientY: number; moved: boolean } | null>(null);
  const gridLayerRef = useRef<Konva.Layer | null>(null);
  const connectorLayerRef = useRef<Konva.Layer | null>(null);
  const boardLayerRef = useRef<Konva.Layer | null>(null);
  const dragLayerRef = useRef<Konva.Layer | null>(null);
  const shapeNodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const dragShapeNodeRefs = useRef<Map<string, Konva.Node>>(new Map());
  const connectorNodeRefs = useRef<Map<string, Konva.Arrow>>(new Map());
  const suppressNextSelectRef = useRef(false);
  const dragLayerShapeIds = useMemo(
    () => new Set(dragLayerState?.shapes.map((shape) => shape.id) ?? []),
    [dragLayerState]
  );

  const applyViewportToLayers = useCallback((nextViewport: ViewportState) => {
    imperativeViewportRef.current = nextViewport;
    [gridLayerRef.current, connectorLayerRef.current, boardLayerRef.current, dragLayerRef.current].forEach((layer) => {
      if (!layer) {
        return;
      }

      layer.position({ x: nextViewport.x, y: nextViewport.y });
      layer.scale({ x: nextViewport.scale, y: nextViewport.scale });
      layer.batchDraw();
    });
  }, []);

  const applyPanTranslationToCanvases = useCallback((deltaX: number, deltaY: number) => {
    [gridLayerRef.current, connectorLayerRef.current, boardLayerRef.current, dragLayerRef.current].forEach((layer) => {
      if (!layer) {
        return;
      }

      const canvas = layer.getNativeCanvasElement();
      canvas.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      canvas.style.transformOrigin = '0 0';
      canvas.style.willChange = 'transform';
    });
  }, []);

  const applyViewportPreviewToCanvases = useCallback((baseViewport: ViewportState, nextViewport: ViewportState) => {
    const scaleRatio = nextViewport.scale / baseViewport.scale;
    const deltaX = nextViewport.x - baseViewport.x * scaleRatio;
    const deltaY = nextViewport.y - baseViewport.y * scaleRatio;

    [gridLayerRef.current, connectorLayerRef.current, boardLayerRef.current, dragLayerRef.current].forEach((layer) => {
      if (!layer) {
        return;
      }

      const canvas = layer.getNativeCanvasElement();
      canvas.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0) scale(${scaleRatio})`;
      canvas.style.transformOrigin = '0 0';
      canvas.style.willChange = 'transform';
    });
  }, []);

  const clearCanvasPreviewFromCanvases = useCallback(() => {
    [gridLayerRef.current, connectorLayerRef.current, boardLayerRef.current, dragLayerRef.current].forEach((layer) => {
      if (!layer) {
        return;
      }

      const canvas = layer.getNativeCanvasElement();
      canvas.style.transform = '';
      canvas.style.transformOrigin = '';
      canvas.style.willChange = '';
    });
  }, []);

  const setBoardLayersListening = useCallback((listening: boolean) => {
    connectorLayerRef.current?.listening(listening);
    boardLayerRef.current?.listening(listening);
  }, []);

  const commitZoomViewport = useCallback(() => {
    const zoomDraft = zoomDraftRef.current;
    if (!zoomDraft) {
      return;
    }

    if (zoomCommitTimeoutRef.current !== null) {
      window.clearTimeout(zoomCommitTimeoutRef.current);
      zoomCommitTimeoutRef.current = null;
    }

    zoomDraftRef.current = null;
    applyViewportToLayers(zoomDraft.latestViewport);
    clearCanvasPreviewFromCanvases();
    setBoardLayersListening(true);
    onViewportChange(zoomDraft.latestViewport);
  }, [applyViewportToLayers, clearCanvasPreviewFromCanvases, onViewportChange, setBoardLayersListening]);

  useEffect(() => {
    if (panDraftRef.current || zoomDraftRef.current) {
      return;
    }

    applyViewportToLayers(viewport);
  }, [applyViewportToLayers, viewport]);

  useEffect(() => () => {
    if (zoomCommitTimeoutRef.current !== null) {
      window.clearTimeout(zoomCommitTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (activeTool !== 'hand') {
      return undefined;
    }

    const frameId = window.requestAnimationFrame(() => {
      dragStateRef.current = null;
      setDragState(null);
      dragLayerStateRef.current = null;
      setDragLayerState(null);
      panDraftRef.current = null;
      clearCanvasPreviewFromCanvases();
      setBoardLayersListening(true);
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeTool, clearCanvasPreviewFromCanvases, setBoardLayersListening]);

  const screenToCanvas = (point: { x: number; y: number }) => {
    const activeViewport = zoomDraftRef.current?.latestViewport ??
      panDraftRef.current?.latestViewport ??
      imperativeViewportRef.current;
    return {
      x: (point.x - activeViewport.x) / activeViewport.scale,
      y: (point.y - activeViewport.y) / activeViewport.scale,
    };
  };

  const pointFromStage = () => {
    const pointer = stageRef.current?.getPointerPosition();
    return pointer ? screenToCanvas(pointer) : null;
  };

  const applySelection = (shapeIds: string[], options: SelectionChangeOptions) => {
    const resolvedIds = onSelectionChange?.(shapeIds, options);
    if (!onSelectionChange) {
      setSelectedIds(shapeIds);
    }

    return resolvedIds ?? shapeIds;
  };

  const eventIsAdditive = (event: MouseEvent | TouchEvent) => (
    'ctrlKey' in event && (event.ctrlKey || event.metaKey || event.shiftKey)
  );

  const setShapeNodeRef = useCallback((shapeId: string, node: Konva.Node | null) => {
    if (node) {
      shapeNodeRefs.current.set(shapeId, node);
    } else {
      shapeNodeRefs.current.delete(shapeId);
    }
  }, []);

  const setDragShapeNodeRef = useCallback((shapeId: string, node: Konva.Node | null) => {
    if (node) {
      dragShapeNodeRefs.current.set(shapeId, node);
    } else {
      dragShapeNodeRefs.current.delete(shapeId);
    }
  }, []);

  const setConnectorNodeRef = useCallback((shapeId: string, node: Konva.Arrow | null) => {
    if (node) {
      connectorNodeRefs.current.set(shapeId, node);
    } else {
      connectorNodeRefs.current.delete(shapeId);
    }
  }, []);

  const boardShapesById = useMemo(
    () => new Map(boardShapes.map((shape) => [shape.id, shape])),
    [boardShapes]
  );

  const boardShapeOrder = useMemo(
    () => new Map(boardShapes.map((shape, index) => [shape.id, index])),
    [boardShapes]
  );

  const boardShapeSpatialIndex = useMemo(() => {
    const cells = new Map<string, CanvasShape[]>();
    const overflowShapes: CanvasShape[] = [];
    const boundsById = new Map<string, ShapeBounds>();

    boardShapes.forEach((shape) => {
      const bounds = shapeBoundsFor(shape);
      boundsById.set(shape.id, bounds);

      const startCellX = Math.floor(bounds.left / spatialCellSize);
      const endCellX = Math.floor((bounds.left + bounds.width) / spatialCellSize);
      const startCellY = Math.floor(bounds.top / spatialCellSize);
      const endCellY = Math.floor((bounds.top + bounds.height) / spatialCellSize);
      const cellCount = (endCellX - startCellX + 1) * (endCellY - startCellY + 1);

      if (cellCount > maxIndexedShapeCells) {
        overflowShapes.push(shape);
        return;
      }

      for (let cellX = startCellX; cellX <= endCellX; cellX += 1) {
        for (let cellY = startCellY; cellY <= endCellY; cellY += 1) {
          const key = `${cellX}:${cellY}`;
          const bucket = cells.get(key);
          if (bucket) {
            bucket.push(shape);
          } else {
            cells.set(key, [shape]);
          }
        }
      }
    });

    return { cells, overflowShapes, boundsById };
  }, [boardShapes]);

  const viewportBounds = useMemo(() => ({
    left: (-viewport.x / viewport.scale) - viewportOverscan,
    top: (-viewport.y / viewport.scale) - viewportOverscan,
    width: (width / viewport.scale) + viewportOverscan * 2,
    height: (height / viewport.scale) + viewportOverscan * 2,
  }), [height, viewport.scale, viewport.x, viewport.y, width]);

  const visibleBoardShapes = useMemo(() => {
    const visibleIds = new Set<string>();
    const checkedIds = new Set<string>();
    const startCellX = Math.floor(viewportBounds.left / spatialCellSize);
    const endCellX = Math.floor((viewportBounds.left + viewportBounds.width) / spatialCellSize);
    const startCellY = Math.floor(viewportBounds.top / spatialCellSize);
    const endCellY = Math.floor((viewportBounds.top + viewportBounds.height) / spatialCellSize);

    const addIfVisible = (shape: CanvasShape) => {
      if (checkedIds.has(shape.id)) {
        return;
      }

      checkedIds.add(shape.id);
      const bounds = boardShapeSpatialIndex.boundsById.get(shape.id) ?? shapeBoundsFor(shape);
      if (boundsIntersect(viewportBounds, bounds)) {
        visibleIds.add(shape.id);
      }
    };

    for (let cellX = startCellX; cellX <= endCellX; cellX += 1) {
      for (let cellY = startCellY; cellY <= endCellY; cellY += 1) {
        boardShapeSpatialIndex.cells.get(`${cellX}:${cellY}`)?.forEach(addIfVisible);
      }
    }

    boardShapeSpatialIndex.overflowShapes.forEach(addIfVisible);
    selectedIds.forEach((shapeId) => {
      if (boardShapesById.has(shapeId)) {
        visibleIds.add(shapeId);
      }
    });

    return [...visibleIds]
      .map((shapeId) => boardShapesById.get(shapeId))
      .filter((shape): shape is CanvasShape => Boolean(shape))
      .sort((left, right) => (boardShapeOrder.get(left.id) ?? 0) - (boardShapeOrder.get(right.id) ?? 0));
  }, [boardShapeOrder, boardShapeSpatialIndex, boardShapesById, selectedIds, viewportBounds]);

  const renderedBoardShapes = useMemo(
    () => visibleBoardShapes.map((shape) => {
      if (dragLayerShapeIds.has(shape.id)) {
        return shape;
      }

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
    [dragLayerShapeIds, dragState, previewPositions, visibleBoardShapes]
  );

  const renderedBoardShapesById = useMemo(
    () => new Map(renderedBoardShapes.map((shape) => [shape.id, shape])),
    [renderedBoardShapes]
  );

  const getRenderedShapeById = useCallback((shapeId?: string | null): CanvasShape | null => {
    if (!shapeId) {
      return null;
    }

    return renderedBoardShapesById.get(shapeId) ?? shapeMap[shapeId] ?? null;
  }, [renderedBoardShapesById, shapeMap]);

  const connectorOrder = useMemo(
    () => new Map(connectors.map((connector, index) => [connector.id, index])),
    [connectors]
  );

  const connectorsByEndpointId = useMemo(() => {
    const endpointMap = new Map<string, CanvasShape[]>();
    const addConnector = (shapeId: string | undefined, connector: CanvasShape) => {
      if (!shapeId) {
        return;
      }

      const bucket = endpointMap.get(shapeId);
      if (bucket) {
        bucket.push(connector);
      } else {
        endpointMap.set(shapeId, [connector]);
      }
    };

    connectors.forEach((connector) => {
      addConnector(connector.attrs.fromShapeId, connector);
      addConnector(connector.attrs.toShapeId, connector);
    });

    return endpointMap;
  }, [connectors]);

  const visibleConnectors = useMemo(() => {
    const visitedConnectorIds = new Set<string>();
    const result: CanvasShape[] = [];

    visibleBoardShapes.forEach((shape) => {
      connectorsByEndpointId.get(shape.id)?.forEach((connector) => {
        if (visitedConnectorIds.has(connector.id)) {
          return;
        }

        visitedConnectorIds.add(connector.id);
        const fromShape = getRenderedShapeById(connector.attrs.fromShapeId);
        const toShape = getRenderedShapeById(connector.attrs.toShapeId);
        if (!fromShape || !toShape) {
          return;
        }

        if (
          boundsIntersect(viewportBounds, shapeBoundsFor(fromShape)) ||
          boundsIntersect(viewportBounds, shapeBoundsFor(toShape))
        ) {
          result.push(connector);
        }
      });
    });

    return result.sort((left, right) => (connectorOrder.get(left.id) ?? 0) - (connectorOrder.get(right.id) ?? 0));
  }, [connectorOrder, connectorsByEndpointId, getRenderedShapeById, viewportBounds, visibleBoardShapes]);

  const gridLines = useMemo(() => {
    const left = -viewport.x / viewport.scale - viewportOverscan;
    const top = -viewport.y / viewport.scale - viewportOverscan;
    const right = left + width / viewport.scale + viewportOverscan * 2;
    const bottom = top + height / viewport.scale + viewportOverscan * 2;
    const startX = Math.floor(left / gridSize) * gridSize;
    const endX = Math.ceil(right / gridSize) * gridSize;
    const startY = Math.floor(top / gridSize) * gridSize;
    const endY = Math.ceil(bottom / gridSize) * gridSize;
    const lines: Array<{ key: string; points: number[]; major: boolean; axis: 'x' | 'y'; value: number }> = [];

    for (let x = startX; x <= endX; x += gridSize) {
      lines.push({ key: `v-${x}`, points: [x, startY, x, endY], major: x % (gridSize * 5) === 0, axis: 'x', value: x });
    }

    for (let y = startY; y <= endY; y += gridSize) {
      lines.push({ key: `h-${y}`, points: [startX, y, endX, y], major: y % (gridSize * 5) === 0, axis: 'y', value: y });
    }

    return lines;
  }, [height, viewport.scale, viewport.x, viewport.y, width]);

  const backgroundFill = backgroundMode === 'blueprint'
    ? '#0f2a3d'
    : backgroundMode === 'paper'
      ? '#fffdf7'
      : backgroundMode === 'plain'
        ? '#f8fafc'
        : '#f8fafc';
  const lineStroke = backgroundMode === 'blueprint'
    ? 'rgba(125, 211, 252, 0.24)'
    : backgroundMode === 'paper'
      ? 'rgba(125, 151, 190, 0.18)'
      : 'rgba(20, 92, 74, 0.08)';
  const majorLineStroke = backgroundMode === 'blueprint'
    ? 'rgba(125, 211, 252, 0.42)'
    : backgroundMode === 'paper'
      ? 'rgba(125, 151, 190, 0.3)'
      : 'rgba(20, 92, 74, 0.16)';

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
    if (panDraftRef.current) {
      return;
    }

    const stage = stageRef.current;
    const pointer = stage?.getPointerPosition();
    if (!pointer) {
      return;
    }

    const currentViewport = zoomDraftRef.current?.latestViewport ?? imperativeViewportRef.current;
    const scaleBy = 1.06;
    const oldScale = currentViewport.scale;
    const pointerBeforeZoom = {
      x: (pointer.x - currentViewport.x) / currentViewport.scale,
      y: (pointer.y - currentViewport.y) / currentViewport.scale,
    };
    const nextScale = Math.min(maxScale, Math.max(minScale, event.evt.deltaY > 0 ? oldScale / scaleBy : oldScale * scaleBy));
    const nextViewport = {
      scale: nextScale,
      x: pointer.x - pointerBeforeZoom.x * nextScale,
      y: pointer.y - pointerBeforeZoom.y * nextScale,
    };

    if (!zoomDraftRef.current) {
      zoomDraftRef.current = {
        baseViewport: imperativeViewportRef.current,
        latestViewport: imperativeViewportRef.current,
      };
      setBoardLayersListening(false);
    }

    zoomDraftRef.current.latestViewport = nextViewport;
    applyViewportPreviewToCanvases(zoomDraftRef.current.baseViewport, nextViewport);

    if (zoomCommitTimeoutRef.current !== null) {
      window.clearTimeout(zoomCommitTimeoutRef.current);
    }
    zoomCommitTimeoutRef.current = window.setTimeout(commitZoomViewport, zoomCommitDelayMs);
  };

  const handleStageMouseDown = (event: Konva.KonvaEventObject<MouseEvent>) => {
    commitZoomViewport();

    // Right-click on empty canvas → pan (regardless of active tool)
    if (event.evt.button === 2) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        rightClickRef.current = { clientX: event.evt.clientX, clientY: event.evt.clientY, moved: false };
        panDraftRef.current = {
          startPointerX: pointer.x,
          startPointerY: pointer.y,
          startViewport: imperativeViewportRef.current,
          latestViewport: imperativeViewportRef.current,
        };
        setBoardLayersListening(false);
        const container = stageRef.current?.container();
        if (container) container.style.cursor = 'grabbing';
      }
      return;
    }

    if (event.target !== event.target.getStage()) {
      return;
    }

    const point = pointFromStage();
    if (!point) {
      return;
    }

    if (activeTool === 'hand') {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        panDraftRef.current = {
          startPointerX: pointer.x,
          startPointerY: pointer.y,
          startViewport: imperativeViewportRef.current,
          latestViewport: imperativeViewportRef.current,
        };
        setBoardLayersListening(false);
      }
      return;
    }

    applySelection([], { source: 'stage' });

    if (activeTool === 'select') {
      setSelectionBox({ startX: point.x, startY: point.y, x: point.x, y: point.y });
      return;
    }

    if (activeTool === 'pen') {
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
    // Right-click on a shape: select it and arm the context menu (opened on mouseup),
    // do not start a drag. cancelBubble prevents the stage from starting a pan.
    if ('button' in event.evt && event.evt.button === 2) {
      event.cancelBubble = true;
      rightClickRef.current = { clientX: event.evt.clientX, clientY: event.evt.clientY, moved: false };
      applySelection([shape.id], { source: 'context' });
      return;
    }

    if (activeTool === 'hand' || activeTool === 'connector' || activeTool === 'pen' || activeTool === 'comment' || activeTool === 'frame') {
      return;
    }

    event.cancelBubble = true;
    const point = pointFromStage();
    if (!point) {
      return;
    }

    const additive = eventIsAdditive(event.evt);
    const isShiftClick = 'shiftKey' in event.evt && event.evt.shiftKey;
    if (isShiftClick && !selectedIds.includes(shape.id)) {
      return;
    }

    const duplicate = 'ctrlKey' in event.evt && (event.evt.ctrlKey || event.evt.metaKey || event.evt.altKey);
    const axisLock = 'shiftKey' in event.evt && event.evt.shiftKey;

    const nextSelectedIds = selectedIds.includes(shape.id)
      ? selectedIds
      : applySelection([shape.id], { source: 'drag', additive });
    suppressNextSelectRef.current = nextSelectedIds.includes(shape.id) && !selectedIds.includes(shape.id);
    const startPositions = Object.fromEntries(
      nextSelectedIds
        .map((shapeId) => getRenderedShapeById(shapeId))
        .filter((selectedShape): selectedShape is CanvasShape => Boolean(selectedShape))
        .map((selectedShape) => [
          selectedShape.id,
          { x: selectedShape.attrs.x, y: selectedShape.attrs.y, shapeType: selectedShape.type },
        ])
    );
    const dragShapes = nextSelectedIds
      .map((shapeId) => getRenderedShapeById(shapeId))
      .filter((selectedShape): selectedShape is CanvasShape => Boolean(selectedShape));

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
      duplicate,
      axisLock,
      selectedIds: nextSelectedIds,
      startPositions,
    };

    dragStateRef.current = nextDragState;
    const nextDragLayerState = { shapes: dragShapes };
    dragLayerStateRef.current = nextDragLayerState;
    dragShapeNodeRefs.current.clear();
    setDragLayerState(nextDragLayerState);
    setDragState(nextDragState);
  };

  const updateShapeDrag = () => {
    const panDraft = panDraftRef.current;
    if (panDraft) {
      const pointer = stageRef.current?.getPointerPosition();
      if (pointer) {
        if (rightClickRef.current) rightClickRef.current.moved = true;
        const deltaX = pointer.x - panDraft.startPointerX;
        const deltaY = pointer.y - panDraft.startPointerY;
        const nextViewport = {
          ...panDraft.startViewport,
          x: panDraft.startViewport.x + deltaX,
          y: panDraft.startViewport.y + deltaY,
        };
        panDraft.latestViewport = nextViewport;
        applyPanTranslationToCanvases(deltaX, deltaY);
      }
      return;
    }

    const point = pointFromStage();

    if (resizeDraft) {
      if (point) {
        const dx = point.x - resizeDraft.startX;
        const dy = point.y - resizeDraft.startY;
        if (resizeDraft.shapeType === 'circle') {
          setResizeDraft((current) => current ? {
            ...current,
            radius: Math.max(16, Math.round((current.startRadius ?? 48) + Math.max(dx, dy) / 2)),
          } : current);
        } else {
          setResizeDraft((current) => current ? {
            ...current,
            w: Math.max(36, Math.round((current.startW ?? 140) + dx)),
            h: Math.max(28, Math.round((current.startH ?? 90) + dy)),
          } : current);
        }
      }
      return;
    }

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

    let x = Math.round(point.x - current.offsetX);
    let y = Math.round(point.y - current.offsetY);
    const rawDx = x - (current.startPositions[current.shapeId]?.x ?? current.x);
    const rawDy = y - (current.startPositions[current.shapeId]?.y ?? current.y);
    if (current.axisLock) {
      if (Math.abs(rawDx) >= Math.abs(rawDy)) {
        y = current.startPositions[current.shapeId]?.y ?? current.y;
      } else {
        x = current.startPositions[current.shapeId]?.x ?? current.x;
      }
    }
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
    const movingNodeRefs = dragLayerStateRef.current ? dragShapeNodeRefs : shapeNodeRefs;
    current.selectedIds.forEach((shapeId) => {
      const startPosition = current.startPositions[shapeId];
      const node = movingNodeRefs.current.get(shapeId);
      if (!startPosition || !node) {
        return;
      }

      node.position({
        x: startPosition.x + nextDragState.dx,
        y: startPosition.y + nextDragState.dy,
      });
    });
    updateConnectorNodesForShapes(current.selectedIds);
    if (dragLayerStateRef.current) {
      dragLayerRef.current?.batchDraw();
    } else {
      stageRef.current?.batchDraw();
    }
    onShapePreview({
      opType: 'update',
      shapeId: current.shapeId,
      shapeType: current.shapeType,
      attrs: { x, y },
    });
  };

  const commitShapeDrag = () => {
    // Right-button release: open context menu only if the cursor did not move (= a click, not a pan)
    const rc = rightClickRef.current;
    if (rc) {
      const panDraft = panDraftRef.current;
      rightClickRef.current = null;
      panDraftRef.current = null;
      const container = stageRef.current?.container();
      if (container) container.style.cursor = '';
      clearCanvasPreviewFromCanvases();
      setBoardLayersListening(true);
      if (rc.moved && panDraft) {
        applyViewportToLayers(panDraft.latestViewport);
        onViewportChange(panDraft.latestViewport);
      }
      if (!rc.moved) {
        onOpenContextMenu?.({ x: rc.clientX, y: rc.clientY });
      }
      return;
    }

    const panDraft = panDraftRef.current;
    if (panDraft) {
      panDraftRef.current = null;
      clearCanvasPreviewFromCanvases();
      setBoardLayersListening(true);
      applyViewportToLayers(panDraft.latestViewport);
      onViewportChange(panDraft.latestViewport);
      return;
    }

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

    if (resizeDraft) {
      const draft = resizeDraft;
      if (draft.shapeType === 'circle') {
        onShapeCommit({
          opType: 'update',
          shapeId: draft.shapeId,
          shapeType: draft.shapeType,
          attrs: { radius: draft.radius ?? draft.startRadius },
        });
      } else {
        onShapeCommit({
          opType: 'update',
          shapeId: draft.shapeId,
          shapeType: draft.shapeType,
          attrs: {
            w: draft.w ?? draft.startW,
            h: draft.h ?? draft.startH,
          },
        });
      }
      setResizeDraft(null);
      return;
    }

    if (selectionBox) {
      const bounds = normalizedBounds(selectionBox);
      const nextSelectedIds = renderedBoardShapes
        .filter((shape) => shape.type !== 'frame')
        .filter((shape) => boundsIntersect(bounds, shapeBounds(shape)))
        .map((shape) => shape.id);
      applySelection(nextSelectedIds, { source: 'marquee' });
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
      suppressNextSelectRef.current = true;
      current.selectedIds.forEach((shapeId) => {
        const startPosition = current.startPositions[shapeId];
        const node = (dragLayerStateRef.current ? dragShapeNodeRefs : shapeNodeRefs).current.get(shapeId);
        if (!startPosition) {
          return;
        }

        const attrs = {
          x: Math.round(startPosition.x + current.dx),
          y: Math.round(startPosition.y + current.dy),
        };

        if (node) {
          node.position(attrs);
        }

        if (current.duplicate) {
          const originalShape = getRenderedShapeById(shapeId);
          if (!originalShape) {
            return;
          }

          onCreateShape({
            opType: 'create',
            shapeId: uniqueId('drag-copy'),
            shapeType: startPosition.shapeType,
            attrs: {
              ...originalShape.attrs,
              ...attrs,
              zIndex: Date.now(),
            },
          });
          return;
        }

        onShapeCommit({ opType: 'update', shapeId, shapeType: startPosition.shapeType, attrs });
      });
    }

    dragStateRef.current = null;
    dragLayerStateRef.current = null;
    dragShapeNodeRefs.current.clear();
    setDragLayerState(null);
    setDragState(null);
  };

  const shapeBounds = useCallback((shape: CanvasShape): ShapeBounds => {
    const startPosition = dragState?.startPositions[shape.id];
    if (!startPosition) {
      return shapeBoundsFor(shape);
    }

    return shapeBoundsFor({
      ...shape,
      attrs: {
        ...shape.attrs,
        x: startPosition.x + dragState.dx,
        y: startPosition.y + dragState.dy,
      },
    });
  }, [dragState]);

  const normalizedBounds = (box: SelectionBox): ShapeBounds => ({
    left: Math.min(box.startX, box.x),
    top: Math.min(box.startY, box.y),
    width: Math.abs(box.x - box.startX),
    height: Math.abs(box.y - box.startY),
  });

  const combinedBounds = (bounds: ShapeBounds[]) => {
    const left = Math.min(...bounds.map((bound) => bound.left));
    const top = Math.min(...bounds.map((bound) => bound.top));
    const right = Math.max(...bounds.map((bound) => bound.left + bound.width));
    const bottom = Math.max(...bounds.map((bound) => bound.top + bound.height));
    return { left, top, width: right - left, height: bottom - top };
  };

  const groupSelectionFrames = useMemo(() => {
    const groups = new Map<string, CanvasShape[]>();
    renderedBoardShapes.forEach((shape) => {
      const groupId = shape.attrs.groupId;
      if (!groupId) {
        return;
      }

      groups.set(groupId, [...(groups.get(groupId) ?? []), shape]);
    });

    const selectedSet = new Set(selectedIds);
    return [...groups.entries()]
      .filter(([, members]) => members.length > 1)
      .map(([groupId, members]) => {
        const allMembersSelected = members.every((member) => selectedSet.has(member.id));
        const hasInnerSelection = activeGroupId === groupId && members.some((member) => selectedSet.has(member.id));
        if (!allMembersSelected && !hasInnerSelection) {
          return null;
        }

        return {
          groupId,
          mode: allMembersSelected ? 'solid' : 'dashed',
          bounds: combinedBounds(members.map(shapeBounds)),
        };
      })
      .filter((frame): frame is { groupId: string; mode: 'solid' | 'dashed'; bounds: ShapeBounds } => Boolean(frame));
  }, [activeGroupId, renderedBoardShapes, selectedIds, shapeBounds]);

  const solidSelectedGroupIds = useMemo(
    () => new Set(groupSelectionFrames.filter((frame) => frame.mode === 'solid').map((frame) => frame.groupId)),
    [groupSelectionFrames]
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

  const shapeWithNodePosition = (shape: CanvasShape) => {
    const node = dragShapeNodeRefs.current.get(shape.id) ?? shapeNodeRefs.current.get(shape.id);
    if (!node) {
      return shape;
    }

    const position = node.position();
    return {
      ...shape,
      attrs: {
        ...shape.attrs,
        x: position.x,
        y: position.y,
      },
    };
  };

  const connectorPointsForShapes = (connector: CanvasShape, fromShape: CanvasShape, toShape: CanvasShape) => {
    const from = anchorPoint(fromShape, connector.attrs.fromAnchor);
    const to = anchorPoint(toShape, connector.attrs.toAnchor);
    return [from.x, from.y, to.x, to.y];
  };

  const connectorPoints = (connector: CanvasShape) => {
    const fromShape = getRenderedShapeById(connector.attrs.fromShapeId);
    const toShape = getRenderedShapeById(connector.attrs.toShapeId);
    if (!fromShape || !toShape) {
      return null;
    }

    return connectorPointsForShapes(connector, fromShape, toShape);
  };

  const liveConnectorPoints = (connector: CanvasShape) => {
    const fromShape = getRenderedShapeById(connector.attrs.fromShapeId);
    const toShape = getRenderedShapeById(connector.attrs.toShapeId);
    if (!fromShape || !toShape) {
      return null;
    }

    return connectorPointsForShapes(
      connector,
      shapeWithNodePosition(fromShape),
      shapeWithNodePosition(toShape)
    );
  };

  const updateConnectorNodesForShapes = (shapeIds: string[]) => {
    const affectedShapeIds = new Set(shapeIds);
    visibleConnectors.forEach((connector) => {
      if (
        !connector.attrs.fromShapeId ||
        !connector.attrs.toShapeId ||
        (!affectedShapeIds.has(connector.attrs.fromShapeId) && !affectedShapeIds.has(connector.attrs.toShapeId))
      ) {
        return;
      }

      const points = liveConnectorPoints(connector);
      const node = connectorNodeRefs.current.get(connector.id);
      if (points && node) {
        node.points(points);
      }
    });
    connectorLayerRef.current?.batchDraw();
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

    const from = getRenderedShapeById(draft.fromShapeId);
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
        onWheel={handleWheel}
        onMouseDown={handleStageMouseDown}
        onMouseMove={updateShapeDrag}
        onMouseUp={commitShapeDrag}
        onMouseLeave={commitShapeDrag}
        onContextMenu={(event) => {
          // Menu opening is handled on right-mouse-up (commitShapeDrag); never open here
          // because contextmenu can fire on mousedown before a drag is detected.
          event.evt.preventDefault();
          event.evt.stopPropagation();
        }}
        onTouchMove={updateShapeDrag}
        onTouchEnd={commitShapeDrag}
      >
        <Layer
          ref={gridLayerRef}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          listening={false}
        >
          <Rect
            x={-viewport.x / viewport.scale - viewportOverscan}
            y={-viewport.y / viewport.scale - viewportOverscan}
            width={width / viewport.scale + viewportOverscan * 2}
            height={height / viewport.scale + viewportOverscan * 2}
            fill={backgroundFill}
            listening={false}
          />
          {backgroundMode !== 'plain' && gridLines.map((line) => (
            <Line
              key={line.key}
              points={line.points}
              stroke={line.major ? majorLineStroke : lineStroke}
              dash={backgroundMode === 'dots' ? [1, gridSize - 1] : undefined}
              strokeWidth={line.major ? 1.2 / viewport.scale : 1 / viewport.scale}
              listening={false}
            />
          ))}
          {showGridLabels && gridLines.filter((line) => line.major).map((line) => (
            <Text
              key={`label-${line.key}`}
              x={line.axis === 'x' ? line.value + 4 : -viewport.x / viewport.scale + 8}
              y={line.axis === 'y' ? line.value + 4 : -viewport.y / viewport.scale + 8}
              text={String(line.value)}
              fontSize={11 / viewport.scale}
              fill={backgroundMode === 'blueprint' ? '#bae6fd' : '#64748b'}
              listening={false}
            />
          ))}
        </Layer>
        <Layer
          ref={connectorLayerRef}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          listening={!dragLayerState}
        >
          {visibleConnectors.map((connector) => {
            const points = connectorPoints(connector);
            if (!points) {
              return null;
            }

            return (
              <Arrow
                ref={(node) => setConnectorNodeRef(connector.id, node)}
                key={connector.id}
                points={points}
                stroke={connector.attrs.stroke}
                fill={connector.attrs.stroke}
                strokeWidth={connector.attrs.strokeWidth}
                pointerLength={connector.attrs.arrowEnd === false ? 0 : 10}
                pointerWidth={connector.attrs.arrowEnd === false ? 0 : 10}
                hitStrokeWidth={12}
                onClick={() => applySelection([connector.id], { source: 'connector' })}
                onTap={() => applySelection([connector.id], { source: 'connector' })}
              />
            );
          })}
        </Layer>
        <Layer
          ref={boardLayerRef}
          x={viewport.x}
          y={viewport.y}
          scaleX={viewport.scale}
          scaleY={viewport.scale}
          listening={!dragLayerState}
        >
          {connectorDraft && (() => {
            const from = getRenderedShapeById(connectorDraft.fromShapeId);
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
          {renderedBoardShapes.filter((shape) => !dragLayerShapeIds.has(shape.id)).map((shape) => {
            const draftForShape = resizeDraft?.shapeId === shape.id ? resizeDraft : null;
            const renderedShape = draftForShape
              ? {
                ...shape,
                attrs: {
                  ...shape.attrs,
                  w: draftForShape.w ?? shape.attrs.w,
                  h: draftForShape.h ?? shape.attrs.h,
                  radius: draftForShape.radius ?? shape.attrs.radius,
                },
              }
              : shape;
            return (
              <ShapeNode
                key={renderedShape.id}
                nodeRef={(node) => setShapeNodeRef(renderedShape.id, node)}
                shape={renderedShape}
                selected={selectedIds.includes(shape.id) && !solidSelectedGroupIds.has(shape.attrs.groupId ?? '')}
                editable={shape.type === 'text' || shape.type === 'sticky' || shape.type === 'comment' || shape.type === 'frame' || shape.type === 'card'}
                dimmed={visibleShapeIds ? !visibleShapeIds.has(shape.id) : false}
                onSelect={(event) => {
                  if (suppressNextSelectRef.current) {
                    suppressNextSelectRef.current = false;
                    return;
                  }

                  applySelection([shape.id], { source: 'shape', additive: eventIsAdditive(event.evt) });
                }}
                onEdit={() => beginEdit(shape)}
                onMoveStart={(event) => beginShapeDrag(shape, event)}
                onResizeStart={(event) => {
                  event.cancelBubble = true;
                  const point = pointFromStage();
                  if (!point) {
                    return;
                  }

                  setResizeDraft({
                    shapeId: shape.id,
                    shapeType: shape.type,
                    startX: point.x,
                    startY: point.y,
                    startW: shape.attrs.w ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 140),
                    startH: shape.attrs.h ?? (shape.type === 'circle' ? (shape.attrs.radius ?? 48) * 2 : 90),
                    startRadius: shape.attrs.radius ?? 48,
                    w: shape.attrs.w,
                    h: shape.attrs.h,
                    radius: shape.attrs.radius,
                  });
                  applySelection([shape.id], { source: 'resize' });
                }}
                onContextMenu={(event) => {
                  // Selection + menu opening handled on mousedown/mouseup; just block default here
                  event.evt.preventDefault();
                  event.evt.stopPropagation();
                }}
                onAnchorStart={(anchor, event) => beginConnectorDraft(shape, anchor, event)}
                showAnchors={
                  (activeTool === 'connector' && shape.id === selectedId) ||
                  connectorDraft?.targetShapeId === shape.id
                }
                highlightedAnchor={connectorDraft?.targetShapeId === shape.id ? connectorDraft.targetAnchor : undefined}
              />
            );
          })}
          {groupSelectionFrames.map((frame) => (
            <Rect
              key={frame.groupId}
              x={frame.bounds.left - 10}
              y={frame.bounds.top - 10}
              width={frame.bounds.width + 20}
              height={frame.bounds.height + 20}
              stroke={frame.mode === 'solid' ? '#1f6feb' : '#2563eb'}
              strokeWidth={2}
              dash={frame.mode === 'dashed' ? [8, 6] : undefined}
              cornerRadius={6}
              listening={false}
            />
          ))}
        </Layer>
        {dragLayerState && (
          <Layer
            ref={dragLayerRef}
            x={viewport.x}
            y={viewport.y}
            scaleX={viewport.scale}
            scaleY={viewport.scale}
            listening={false}
          >
            {dragLayerState.shapes.map((shape) => (
              <ShapeNode
                key={shape.id}
                nodeRef={(node) => setDragShapeNodeRef(shape.id, node)}
                shape={shape}
                selected={selectedIds.includes(shape.id)}
                editable={false}
                dimmed={visibleShapeIds ? !visibleShapeIds.has(shape.id) : false}
                onSelect={() => undefined}
                onEdit={() => undefined}
                onMoveStart={() => undefined}
                onResizeStart={() => undefined}
                onContextMenu={() => undefined}
                onAnchorStart={() => undefined}
                showAnchors={false}
              />
            ))}
          </Layer>
        )}
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
  nodeRef: (node: Konva.Node | null) => void;
  selected: boolean;
  editable: boolean;
  onSelect: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onEdit: () => void;
  onMoveStart: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onResizeStart: (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  onContextMenu: (event: Konva.KonvaEventObject<MouseEvent>) => void;
  onAnchorStart: (anchor: AnchorName, event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => void;
  showAnchors: boolean;
  highlightedAnchor?: AnchorName;
  dimmed?: boolean;
};

function ShapeNode({
  shape,
  nodeRef,
  selected,
  editable,
  onSelect,
  onEdit,
  onMoveStart,
  onResizeStart,
  onContextMenu,
  onAnchorStart,
  showAnchors,
  highlightedAnchor,
  dimmed = false,
}: ShapeNodeProps) {
  const common = {
    ref: nodeRef,
    x: shape.attrs.x,
    y: shape.attrs.y,
    draggable: false,
    onClick: onSelect,
    onTap: onSelect,
    onDblClick: editable ? onEdit : undefined,
    onDblTap: editable ? onEdit : undefined,
    onMouseDown: onMoveStart,
    onContextMenu,
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

  const resizeHandle = (x: number, y: number) => selected && shape.type !== 'connector' && shape.type !== 'pen' ? (
    <Rect
      x={x - 6}
      y={y - 6}
      width={12}
      height={12}
      fill="#ffffff"
      stroke="#1f6feb"
      strokeWidth={2}
      cornerRadius={3}
      onMouseDown={onResizeStart}
      onTouchStart={onResizeStart}
    />
  ) : null;

  if (shape.type === 'pen') {
    return (
      <Line
        ref={nodeRef as (node: Konva.Line | null) => void}
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
        {resizeHandle(width, height)}
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
        {resizeHandle(width, height)}
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
        {resizeHandle(radius, radius)}
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
        {resizeHandle(width, height)}
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
    // Responsive layout so corner labels never overlap the center text on small cards.
    const showBottomRow = height >= 96;            // tags (left) + priority (right) row
    const bottomRowY = height - 26;
    const showAssignee = Boolean(shape.attrs.assignee) && height >= 132;
    const assigneeY = height - 48;
    const bodyTop = 72;
    const bodyBottomLimit = showAssignee ? assigneeY : (showBottomRow ? bottomRowY : height - 8);
    const bodyHeight = Math.max(0, bodyBottomLimit - bodyTop - 4);
    const showBody = bodyHeight >= 14;
    const showTitle = height >= 58;
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
        {showTitle && (
          <Text
            text={shape.attrs.title ?? 'New idea'}
            x={14}
            y={44}
            width={width - 28}
            height={24}
            fontSize={18}
            fontStyle="bold"
            fill={shape.attrs.textColor ?? '#111827'}
            ellipsis
          />
        )}
        {showBody && (
          <Text
            text={shape.attrs.body ?? ''}
            x={14}
            y={bodyTop}
            width={width - 28}
            height={bodyHeight}
            fontSize={14}
            fill="#334155"
            lineHeight={1.2}
            ellipsis
            wrap="word"
          />
        )}
        {showAssignee && (
          <Text
            text={shape.attrs.assignee}
            x={14}
            y={assigneeY}
            width={width - 28}
            height={16}
            fontSize={12}
            fill="#64748b"
            ellipsis
          />
        )}
        {showBottomRow && (
          <>
            <Text
              text={tags.slice(0, 3).map((tag) => `#${tag}`).join('  ')}
              x={14}
              y={bottomRowY}
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
              y={bottomRowY - 1}
              width={78}
              height={18}
              align="right"
              fontSize={12}
              fontStyle="bold"
              fill="#0f172a"
            />
          </>
        )}
        {selectionOutline(width, height, 0, 0, shape.attrs.cornerRadius ?? 8)}
        {resizeHandle(width, height)}
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
        {resizeHandle(width, height)}
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
        {resizeHandle(width, height)}
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
      {resizeHandle(shape.attrs.w ?? 140, shape.attrs.h ?? 90)}
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

import type { ShapeOperation, ShapeType } from '../types/protocol';

export const uniqueId = (prefix: string) => (
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
);

export const createShapeOp = (shapeType: ShapeType, x: number, y: number): ShapeOperation => {
  const shapeId = uniqueId('shape');
  const zIndex = Date.now();

  if (shapeType === 'circle') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: { x, y, radius: 48, fill: '#f59f00', stroke: '#5f3700', strokeWidth: 2, zIndex },
    };
  }

  if (shapeType === 'text') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        text: 'Cocanvas',
        fill: 'transparent',
        textColor: '#08060d',
        fontSize: 28,
        fontStyle: 'bold',
        stroke: 'transparent',
        strokeWidth: 0,
        zIndex,
      },
    };
  }

  if (shapeType === 'sticky') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        w: 190,
        h: 170,
        text: 'Add idea',
        fill: '#ffd966',
        textColor: '#202124',
        fontSize: 22,
        stroke: 'transparent',
        strokeWidth: 0,
        cornerRadius: 10,
        zIndex,
      },
    };
  }

  if (shapeType === 'card') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        w: 260,
        h: 168,
        title: 'New idea',
        body: 'Describe the signal, decision, or next step.',
        tags: ['Insight'],
        priority: 'medium',
        status: 'idea',
        assignee: '',
        votes: 0,
        voters: [],
        fill: '#dcfce7',
        stroke: '#15803d',
        strokeWidth: 2,
        textColor: '#111827',
        fontSize: 16,
        cornerRadius: 8,
        zIndex,
      },
    };
  }

  if (shapeType === 'diamond' || shapeType === 'triangle') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: { x, y, w: 132, h: 104, fill: '#9fc5e8', stroke: '#1f4e79', strokeWidth: 2, zIndex },
    };
  }

  if (shapeType === 'comment') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        w: 220,
        h: 86,
        text: 'Comment',
        fill: '#ffffff',
        textColor: '#111827',
        fontSize: 16,
        stroke: '#f59e0b',
        strokeWidth: 2,
        cornerRadius: 8,
        resolved: false,
        zIndex,
      },
    };
  }

  if (shapeType === 'frame') {
    return {
      opType: 'create',
      shapeId,
      shapeType,
      attrs: {
        x,
        y,
        w: 520,
        h: 320,
        text: 'Frame',
        fill: 'rgba(255,255,255,0.02)',
        textColor: '#475569',
        fontSize: 20,
        stroke: '#64748b',
        strokeWidth: 2,
        zIndex: -10,
      },
    };
  }

  return {
    opType: 'create',
    shapeId,
    shapeType,
    attrs: {
      x,
      y,
      w: 140,
      h: 90,
      fill: shapeType === 'roundedRect' ? '#b7e1cd' : '#3498db',
      stroke: shapeType === 'roundedRect' ? '#145c4a' : '#123a32',
      strokeWidth: 2,
      cornerRadius: shapeType === 'roundedRect' ? 18 : 0,
      zIndex,
    },
  };
};

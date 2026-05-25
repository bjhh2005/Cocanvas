package com.cocanvas.protocol.common;

import java.util.Map;

public record ShapeOperation(
        String opType,
        String shapeId,
        String shapeType,
        Map<String, Object> attrs
) {
}

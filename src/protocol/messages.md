# Cocanvas WebSocket Messages

## Client To Server

### join

```json
{
  "type": "join",
  "msgId": "uuid",
  "roomId": "a1b2c3d4",
  "userId": "u-uuid",
  "displayName": "Alice",
  "color": "#e74c3c"
}
```

### cursor

```json
{
  "type": "cursor",
  "msgId": "uuid",
  "roomId": "a1b2c3d4",
  "userId": "u-uuid",
  "x": 312.5,
  "y": 488
}
```

### op

```json
{
  "type": "op",
  "msgId": "uuid",
  "roomId": "a1b2c3d4",
  "userId": "u-uuid",
  "hlc": "1716123456789.0.u-uuid",
  "op": {
    "opType": "create",
    "shapeId": "shape-uuid",
    "shapeType": "rect",
    "hlc": "1716123456789.0.u-uuid",
    "writerId": "u-uuid",
    "attrs": {
      "x": 100,
      "y": 120,
      "w": 140,
      "h": 90,
      "fill": "#3498db"
    }
  }
}
```

## Server To Client

### joined

```json
{
  "type": "joined",
  "roomId": "a1b2c3d4",
  "you": { "userId": "u-uuid", "displayName": "Alice", "color": "#e74c3c" },
  "peers": []
}
```

### peer-joined

```json
{
  "type": "peer-joined",
  "userId": "u-uuid",
  "displayName": "Alice",
  "color": "#e74c3c"
}
```

### peer-left

```json
{
  "type": "peer-left",
  "userId": "u-uuid"
}
```

### cursor

```json
{
  "type": "cursor",
  "userId": "u-uuid",
  "x": 312.5,
  "y": 488
}
```

### op

```json
{
  "type": "op",
  "userId": "u-uuid",
  "hlc": "1716123456790.0.node-local",
  "op": {
    "opType": "create",
    "shapeId": "shape-uuid",
    "shapeType": "rect",
    "hlc": "1716123456790.0.node-local",
    "writerId": "u-uuid",
    "attrs": {
      "x": 100,
      "y": 120,
      "w": 140,
      "h": 90,
      "fill": "#3498db"
    }
  }
}
```

### error

```json
{
  "type": "error",
  "code": "not_joined",
  "message": "Send join before cursor"
}
```

# Input

Multi-touch input, DOM plus node capture, and world-coord reprojection during camera moves.

## Layout

`InputSystem` is per-stage. The primary stage always has one, and `engine.input` is a shortcut to `engine.primaryStage.input`. Secondary stages get their own when constructed with `interactive: true` in `StageOptions`; otherwise `stage.input === null` and pointer events on that canvas are ignored. See [Stages](/guides/stages).

Each `InputSystem` attaches to its stage's canvas and listens for `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, and `lostpointercapture`. It also swallows `contextmenu`, so a long-press doesn't open the system menu.

Every currently-down pointer lives in a `Map<pointerId, PointerStateSnapshot>` exposed as `stage.input.pointers` (or `engine.input.pointers` for the primary). Each snapshot:

```ts
interface PointerStateSnapshot {
  id: number // stable across a gesture
  kind: 'touch' | 'mouse' | 'pen'
  screen: Readonly<Vec2> // CSS px, canvas-local
  world: Readonly<Vec2> // reprojected each frame
  startedAtMs: number
  capturedBy: SceneNode | null
}
```

`world` is refreshed by `input.beforeFrame()` at the top of every render frame, using the current active camera's `screenToWorld`.

## Node capture

On `pointerdown` the input system:

1. Reads the event's client coords, subtracts the canvas rect for canvas-local CSS px, and converts to world via that stage's active camera.
2. Calls `canvas.setPointerCapture(pointerId)`, so the browser routes every follow-up event for that pointer back to the canvas even as the finger slides past the element's edge.
3. Walks the stage's scene back-to-front, filters to nodes with `hitEnabled === true` and `visible === true`, and calls `node.hitTest(worldX, worldY, touchSlopWorld)`. The first hit captures the pointer.
4. Calls the captured node's `onPointerDown(e)` and emits `pointerDown` on that stage's `stage.events`.

Subsequent `pointermove` / `pointerup` / `pointercancel` for that pointer dispatch to the captured node's matching handler, regardless of whether the pointer is still over the node's shape, and emit on `stage.events` with `capturedBy` populated.

Destroying a captured node dispatches a synthetic `cancel` event and releases both DOM and node capture.

## Per-stage event bus vs `engine.events`

Pointer events emit on `stage.events`, not directly on `engine.events`. The primary stage's events are forwarded to `engine.events` by the engine constructor, so code that listens on `engine.events.on('pointerDown', ...)` keeps receiving primary-canvas events. Secondary stages do not forward; their events stay on `stage.events` only.

So `engine.events.on('pointerXxx', ...)` fires only for the primary canvas. A tap on a secondary canvas can't reach the main game's global handlers; the cross-canvas footgun is walled off at the emitter layer.

Listen to a specific secondary stage through its own emitter:

```ts
const stage = engine.attachStage(secondaryCanvas, { interactive: true })
const off = stage.events.on('pointerDown', (e) => {
  // only fires for taps on this canvas
})
```

`PointerEvent2D` also carries `e.stage` for callers that want to route at the engine level, but per-stage subscription is cleaner.

## Wiring pointer handlers

Set the callbacks on the node, or from a behavior's `onAttach`:

```ts
const shape = new ShapeNode({
  geometry: { kind: 'circle', radius: 60 },
  fill: '#ffd34d',
})
shape.hitEnabled = true
shape.onPointerDown = (e) => {
  console.log('grabbed', e.pointer.id, 'at', e.pointer.world)
}
shape.onPointerMove = (e) => {
  shape.transform.x = e.pointer.world.x
  shape.transform.y = e.pointer.world.y
}
shape.onPointerUp = (e) => {
  console.log('released', e.pointer.id)
}
shape.onPointerCancel = (e) => {
  // Fired when the node is destroyed mid-drag, or the browser drops capture.
  console.log('cancel', e.pointer.id, e.source) // source: 'native' | 'synthetic'
}
```

`Path2DNode` and `ShapeNode` set `hitEnabled = true` automatically when constructed with a hit mode other than `'none'`. `SceneNode`, `PolylineNode`, and plain `SceneNode` don't hit-test until you flip the flag.

## Two pointers, two shapes

Node capture is per pointer. Two fingers on two shapes give each shape its own capture; each shape sees only its own pointer's events, and each pointer's `capturedBy` points at its own shape.

## Continuous world reprojection

The `world` field of every active pointer is recomputed at the start of each frame from the stored `screen` coord and the current active camera. This matters when the camera moves under a still finger:

- `Camera.animateTo` tweens the viewport rect. The pointer hasn't physically moved between frames, but the world beneath it has shifted.
- A debug-camera pan shifts the active camera's viewport the same way.

When the world drifts and no native `pointermove` fired that frame, the input system emits a synthetic `pointerMove` with `e.source === 'synthetic'` on both the captured node and the stage's events. A drag handler that repositions its node from `e.pointer.world` keeps the shape under the cursor with no visual lag.

## Touch slop

`engine.input.touchSlopScreen` is the CSS-pixel radius the system uses to inflate hit targets (default 30 px, roughly a fingertip). `engine.input.touchSlopWorld` converts it into world units via the active camera's `screenPxPerWorldUnit()`. Both are read fresh on every hit test, so slop stays a constant physical size as the camera zooms.

Change it for the whole engine:

```ts
engine.input.setTouchSlopScreen(20)
```

Individual nodes can widen their own `hitTest` further, for example a `Path2DNode` with `hitMode: 'circle'` and a large `hitRadiusWorld`.

## Preventing browser gestures

The `mountEngine` action sets `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none`, and `outline: none` on the canvas, and the input system blocks `contextmenu`. Together these stop pinch-zoom, text selection, the touch callout, and the context menu while a game runs. Anything higher in the DOM needs its own handling.

## When the browser drops capture

If the browser fires `lostpointercapture` on a pointer the system still holds (rare, usually a browser bug or an extension removing the element), it treats it as a native cancel: the captured node's `onPointerCancel` fires with `e.source === 'native'`, DOM capture is released, and the pointer leaves the map.

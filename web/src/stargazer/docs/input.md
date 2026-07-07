# Input

Multi-touch input, DOM + node capture, and continuous world-coord reprojection during camera moves.

## Layout

`InputSystem` is **per-stage**. The primary stage always has one; `engine.input` is a shortcut to `engine.primaryStage.input`. Secondary stages get their own when constructed with `interactive: true` in `StageOptions`; otherwise `stage.input === null` and pointer events on that canvas are ignored. See [`stages.md`](./stages.md) for the flag.

Each `InputSystem` attaches to its stage's canvas and listens for `pointerdown`, `pointermove`, `pointerup`, `pointercancel`, and `lostpointercapture`. It also swallows `contextmenu` so a long-press on the kiosk doesn't pop up the system menu.

Every currently-down pointer lives in a `Map<pointerId, PointerStateSnapshot>` accessible as `stage.input.pointers` (or `engine.input.pointers` for the primary). Each snapshot has:

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

1. Reads the raw event's `clientX/Y`, subtracts `stage.canvas.getBoundingClientRect()` for canvas-local CSS px, converts to world via that stage's active camera (`engine.debug?.activeCameraFor(stage) ?? stage.camera`).
2. Calls `canvas.setPointerCapture(pointerId)`. The browser now routes every follow-up event for that pointer ID back to the canvas, so a finger sliding past the physical bezel keeps producing `pointermove` and `pointerup`.
3. Walks THIS stage's scene back-to-front, filters to nodes with `hitEnabled === true` and `visible === true`, and calls `node.hitTest(worldX, worldY, touchSlopWorld)`. The first hit captures the pointer.
4. Calls the captured node's `onPointerDown(e)` and emits `pointerDown` on **that stage's** `stage.events` (not the engine bus; see the cross-talk section below).

Subsequent `pointermove` / `pointerup` / `pointercancel` for that pointer ID:

- Dispatch to the captured node's `onPointerMove` / `onPointerUp` / `onPointerCancel`, regardless of whether the pointer is still over that node's shape.
- Emit on `stage.events` with `capturedBy` populated.

Destroying a captured node dispatches a synthetic `cancel` event and releases both DOM and node capture. The `?demo=input` demo verifies this with a `D`-to-destroy shortcut mid-drag.

## Per-stage event bus vs `engine.events`

**Pointer events emit on `stage.events`, not directly on `engine.events`.** The primary stage's events are forwarded to `engine.events` by the Engine constructor so game code that already listens on `engine.events.on('pointerDown', ...)` keeps receiving primary-canvas events. Secondary stages do NOT forward; their events stay on `stage.events` only.

The upshot: **`engine.events.on('pointerXxx', ...)` fires only for the primary canvas.** If the main game listens to `engine.events` for input, tapping a tutorial or loss-card canvas will NOT accidentally spawn a game packet or start a timer; the cross-canvas footgun is walled off at the emitter layer.

Listen to a specific secondary stage's input via its own emitter:

```ts
const stage = engine.attachStage(cardCanvas, { interactive: true })
const off = stage.events.on('pointerDown', (e) => {
  // only fires for taps on cardCanvas
})
```

`PointerEvent2D` also carries `e.stage` for callers that want to route at the engine level, but preferring per-stage subscription is cleaner.

## Wiring pointer handlers

Set the callbacks directly on the node or from a Behaviour's `onAttach`:

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

`Path2DNode` and `ShapeNode` set `hitEnabled = true` automatically when constructed with a hit mode other than `'none'`. `GroupNode`, `PolylineNode`, and plain `SceneNode` don't participate in hit-testing until you flip the flag.

## Two pointers, two shapes

Node capture is per pointer. Two fingers on two different shapes give each shape its own capture. Each shape sees only its own pointer's events; each pointer's `capturedBy` points at its own shape.

The `?demo=input` demo runs two draggable shapes that both track their pointer via `e.pointer.id`. Drag either with a mouse, or both simultaneously with two fingers on a touchscreen.

## Continuous world reprojection

The `world` field of every active pointer is recomputed at the start of each render frame from the stored `screen` coord and the current active camera. This matters for camera-moves-under-a-still-finger:

- `Camera.animateTo` tweens the viewport rect. Between frames the pointer hasn't physically moved, but the world beneath it has shifted.
- Debug camera panning (`WASD`) shifts the active camera's viewport the same way.

When world drifts and no native `pointermove` fired that frame, the input system emits a synthetic `pointerMove` with `e.source === 'synthetic'` on both the captured node and `engine.events`. Behaviours that reposition their node from `e.pointer.world` (like the drag handler above) keep the shape glued to the cursor with no visual lag.

Verify by running `?demo=input`, starting a drag, opening the debug HUD with `?debug=hud`, pressing `C` to swap in the debug camera, then panning with `WASD`. The shape stays under the cursor.

## Touch slop

`engine.input.touchSlopScreen` is the CSS-pixel radius the system uses to inflate hit targets (default 30 px, roughly a fingertip). `engine.input.touchSlopWorld` converts that into world units via the active camera's `screenPxPerWorldUnit()`. Both are read fresh on every hit-test, so slop stays a constant physical size even as the camera zooms.

Change the slop for the whole engine:

```ts
engine.input.setTouchSlopScreen(20)
```

Individual nodes can override further by widening their own `hitTest`; e.g., `Path2DNode` with `hitMode: 'circle'` and a large `hitRadiusWorld`.

## Kiosk hygiene

The `mountEngine` action sets `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none`, and `outline: none` on the canvas element. The input system additionally blocks `contextmenu` events. Between them, the browser can't pinch-zoom, select text, show the callout, or open its context menu while a game is running.

Anything higher up in the DOM (parent containers, app layout) still needs its own hygiene; most of that is already in `src/styles/global.sass`.

## When the browser drops capture

If the browser fires `lostpointercapture` on a pointer we still hold (rare; usually a browser bug or an extension removing the element), the input system treats it as a native cancel. The captured node's `onPointerCancel` fires with `e.source === 'native'`, DOM capture is released, and the pointer is removed from the map.

---
title: Input
group: Features
order: 6
---

# Input

Stargazer handles mouse, touch and pen input as pointers, with any number of fingers at once. When a pointer goes down on a node, that node captures it. The node then receives every move, release and cancel of that pointer, even after the pointer leaves the node's shape.

Each interactive {@link Stage} has an {@link InputSystem} that listens on its canvas. The primary stage always has one, reached as `engine.input`. Pointer positions arrive in world units, so they match the coordinates you place nodes in. Nodes and the tree are described in [Scene graph](/guides/scene).

## Basic usage

Give a node pointer handlers with [`bindPointer`](/module/scene/node2d#bindpointer):

```ts
import { ShapeNode } from '@src/stargazer'

const ball = new ShapeNode({
  geometry: { kind: 'circle', radius: 60 },
  fill: '#ffd34d',
})
scene.root.add(ball)

const unbind = ball.bindPointer({
  down: (e) => console.log('grabbed', e.pointer.id),
  move: (e) => {
    ball.transform.x = e.pointer.world.x
    ball.transform.y = e.pointer.world.y
  },
  up: () => console.log('released'),
})
```

Pressing the circle grabs it, and the circle follows the pointer until release. The ball sits directly under the root, so its position is in world units and `e.pointer.world` can be written to it as is. `unbind()` removes exactly these handlers.

### Handling pointers on a node

`bindPointer` takes `down`, `move`, `up` and `cancel` handlers. A `cancel` arrives when the browser cancels the gesture or drops the capture. Only nodes with `hitEnabled` set take part in hit testing. `bindPointer` sets it when the handlers include `down`, and `unbind()` clears it again if it set it. Pass `hitEnabled: false` to bind without it.

A {@link Path2DNode} with a `hitMode` other than `'none'` turns `hitEnabled` on itself. Every other node starts with it off.

You can also assign `onPointerDown`, `onPointerMove`, `onPointerUp` and `onPointerCancel` on a node directly. The input system calls those. Then you set `hitEnabled` and clear the handlers yourself.

### Pointer events

Every handler receives a {@link PointerEvent2D}. Its fields are:

- `pointer`, a {@link PointerStateSnapshot} with `id`, `kind` (`'touch'`, `'mouse'` or `'pen'`), `screen`, `world`, `startedAtMs` and `capturedBy`
- `delta`, the world movement since the previous event for this pointer
- `phase`, one of `'down'`, `'move'`, `'up'` and `'cancel'`
- `source`, `'native'` for a browser event and `'synthetic'` for one the engine made
- `stage`, the stage whose canvas the pointer is on
- `localTo(node)`, the pointer's position in a node's local space

`screen` is in CSS pixels from the canvas's top left corner. `id` stays the same for the whole gesture.

### Local coordinates

`e.pointer.world` is in world space. A node under a moved, scaled or rotated parent needs the position in its parent's space instead. [`localTo`](/module/input/pointerevent2d#localto) converts it:

```ts
piece.bindPointer({
  move: (e) => {
    const p = e.localTo(board) // board is the piece's parent
    piece.transform.x = p.x
    piece.transform.y = p.y
  },
})
```

`localTo` takes an optional `out` object to fill. It also handles nodes under a {@link Layer}, see [Pointers and layers](#pointers-and-layers).

### Buttons

A {@link ButtonBehavior} turns a node into a tap button. The button is pressed on `down`. `onClick` fires on `up` only if the release is still over the node, so a press dragged off the button does nothing.

```ts
import { ButtonBehavior } from '@src/stargazer'

node.addBehavior(
  new ButtonBehavior({
    onClick: () => openMenu(),
    enabled: () => canInteract(),
    onPressedChange: (pressed) => (node.pressed = pressed),
  }),
)
```

The node draws itself. `onPressedChange` reports the pressed state, so make `pressed` a paint property of the node and it repaints when the state flips. `enabled` is a boolean or a function. While it is false the button ignores presses and clicks.

### Drag and drop

A {@link DraggableBehavior} carries a node onto a drop target, such as a card into a slot:

```ts
import { DraggableBehavior } from '@src/stargazer'

node.addBehavior(
  new DraggableBehavior<Cell>({
    dragLayer,
    findDropTarget: (w) => cellAt(w.x, w.y),
    onDrop: (cell) => place(node, cell),
  }),
)
```

Pressing and moving the node past 8 world units starts a drag. The node moves into `dragLayer` so that it draws above its neighbors, and follows the pointer with the grabbed point under the finger. On release over a target, `onDrop` receives the target. On release over nothing, the node slides back to where it started.

### Listening to the whole stage

Every pointer event is also emitted on the stage's event bus, whether or not a node captured it. For the primary stage, listen on `engine.events`:

```ts
const off = engine.events.on('pointerDown', (e) => {
  spawnRipple(e.pointer.world)
})
```

The handler runs for every press on the primary canvas. Call `off()` to stop listening. The events are `pointerDown`, `pointerMove`, `pointerUp` and `pointerCancel`.

## Advanced usage

This section covers how capture works, multi-touch, region gestures, hold buttons, drag details, event buses, layers, touch slop, and edge cases.

### How a press finds its node

On `pointerdown`, the input system does these steps:

1. Converts the event's position to CSS pixels on the canvas.
2. Calls `canvas.setPointerCapture(pointerId)`, so the browser keeps sending this pointer's events to the canvas when it slides past the canvas edge.
3. Checks the 2D nodes from the topmost drawn down, skipping hidden nodes and nodes with `hitEnabled` false. For each node it converts the position into the world of the view that places that node and calls `node.hitTest(x, y, touchSlop)`. The first node that returns true captures the pointer.
4. If no 2D node was hit, casts a ray into the 3D scene and picks the nearest {@link Node3D} with `hitEnabled` set. See [3D](/guides/3d).
5. Calls the captured node's `onPointerDown`, then emits `pointerDown` on `stage.events`.

Later moves, releases and cancels of that pointer go to the captured node, wherever the pointer is. They are also emitted on `stage.events`. Hit testing is described in [Scene graph](/guides/scene).

### Single pointer and multi-touch

Capture is per pointer. Two fingers on two shapes give each shape its own capture. Each shape receives only its own pointer's events, and each pointer's `capturedBy` is its own shape.

One node can also receive several pointers at once. Pass `singlePointer: true` to `bindPointer` to follow only the first:

```ts
node.bindPointer({
  singlePointer: true,
  down: (e) => startDrag(e),
  move: (e) => drag(e.localTo(board)),
  up: () => endDrag(),
})
```

While the first pointer is down, the handlers ignore every other pointer. The slot frees when the first pointer is released or canceled. {@link ButtonBehavior}, {@link HoldButtonBehavior} and {@link DraggableBehavior} follow a single pointer by default. Their `singlePointer` option turns that off.

### Region gestures

{@link bindRegionGesture} reacts to presses on an area of the primary stage instead of on a node. Use it for a board you tap to drop a piece, or a strip you swipe from:

```ts
import { bindRegionGesture } from '@src/stargazer'

const off = bindRegionGesture(engine, {
  hitTest: (w) => insideBoard(w.x, w.y),
  enabled: () => state === 'playing',
  down: (e) => beginPreview(e),
  move: (e) => movePreview(e),
  up: (e) => commitDrop(e),
  onReject: () => openMenu(), // a press outside the board
})
// off() removes the binding
```

A press is accepted when `hitTest` and `enabled` both pass. It is given to `onReject` otherwise. The binding then follows that pointer through `move`, `up` and `cancel`. It never hears from pointers it did not accept, so a finger that landed outside `hitTest` never arrives as a stray `move` or `up`.

`hitTest` receives the camera's world position. The binding follows one pointer by default. Set `singlePointer: false` for a multi-touch region, which follows every pointer it accepts. The binding listens on `engine.events`, so it hears presses whether or not a node captured them.

### Hold and auto-repeat

{@link ButtonBehavior} fires on release. That suits a menu item, but a game control should act the moment the finger lands. {@link HoldButtonBehavior} fires `onPress` on the press, and can repeat while held:

```ts
import { HoldButtonBehavior } from '@src/stargazer'

node.addBehavior(
  new HoldButtonBehavior({
    onPress: () => shift(-1),
    repeat: { delay: 0.17, interval: 0.05 },
    enabled: () => state === 'playing' && !paused,
    onPressedChange: (pressed) => (node.pressed = pressed),
  }),
)
```

The first `onPress` fires on the press. After `delay` seconds it fires again every `interval` seconds until release. Omit `repeat` for a single press per touch. For a continuous effect, such as a thruster, omit `repeat` and read `behavior.pressed` in your own `onFixedStep`, so the effect grows with time and not with the number of callbacks.

The repeat runs on the fixed step, so its rate is the same at any display refresh rate. An `interval` shorter than the fixed step fires several times within one step to keep its rate. The behavior checks `enabled` on the press and on every fixed step, and a false result releases the hold.

The fixed step stops while the engine is paused, but pointer handlers do not. A finger held across a pause would resume the repeat and fire the moment the engine unpauses. An `enabled` function that returns false while paused releases the hold instead.

The repeat continues when the finger drifts off the node, because the node keeps the capture.

### Drag and drop in detail

{@link DraggableOptions} has these hooks, in the order they fire:

- `onDragStart(e)` when the press travels past `threshold` (default 8 world units)
- `onDragMove(target, e)` when the target under the pointer changes, with `null` over no target
- `onDrop(target, e)` on release over a target
- `onDragCancel(e)` on release over no target, or with no event for a system cancel, before the slide back
- `onTap(e)` on a release before the drag started
- `onSettled()` when the node is back home and at rest, after a drop or after the slide back

A drop target is whatever `findDropTarget` returns: a node, a grid cell, an id. `onDragMove` compares targets with `equals`, which defaults to `===`. A `findDropTarget` that returns a new object on each call must pass `equals` or return the same objects.

The node stays in `dragLayer` while it slides back, and returns to its home parent only when it arrives. A layout pass that skips nodes in the drag layer does not fight the animation.

Returning home appends the node as the last child of its home parent. `snapBack: false` returns it at once, and `snapDuration` sets the slide in seconds (default 0.18).

Without `dragLayer`, the node is dragged in its own parent. A press during the slide back grabs the node again. `isDragging` is true during a drag and its slide back.

### Per-stage event bus vs `engine.events`

Pointer events are emitted on `stage.events` of the stage they happen on. The engine forwards the primary stage's pointer events to `engine.events`. Secondary stages do not forward, so a tap on a second canvas never reaches handlers on `engine.events`.

A secondary stage gets an input system only when it is created with `interactive: true`. Otherwise `stage.input` is `null` and its canvas ignores pointers. Listen to it on its own bus:

```ts
const stage = engine.attachStage(secondCanvas, { interactive: true })
const off = stage.events.on('pointerDown', (e) => {
  // runs only for presses on secondCanvas
})
```

Every event also has `e.stage`, for code that handles several stages in one place. See [Stages](/guides/stages).

### Active pointers

`stage.input.pointers`, or `engine.input.pointers` for the primary stage, is a map from pointer id to {@link PointerStateSnapshot}. It holds every pointer that is down:

```ts
for (const p of engine.input.pointers.values()) {
  if (p.capturedBy === ball) drawMarker(p.world)
}
```

`world` in the map is the camera's world position.

### Continuous world reprojection

At the start of each frame, the input system computes each active pointer's world position again from its screen position and the active camera. The world under a still finger moves when the camera moves, for example during `animateTo` or a pan of the debug camera.

When the world position changes and no native `pointermove` came that frame, the input system emits a move with `e.source === 'synthetic'`. A drag handler that places its node at the pointer keeps the node under the finger while the camera moves.

The captured node and the stage are told separately, because each sees its own space and only one of them may have moved. A pointer held on a node under a screen {@link Layer} gets no synthetic move on the node while the camera pans. The stage's listeners still get one.

### Pointers and layers

A node under a {@link Layer} with a space of its own is placed by the layer's view, not the camera's. Input follows the placement. The node is hit-tested where the layer draws it, and its events carry positions in the layer's space. So `pointer.world` has two meanings:

- On a stage-level event (`stage.events`, `engine.events`) and in `input.pointers`, it is the camera's world.
- On an event a node receives for a pointer it holds, it is the world of the view that places that node.

For a node under the camera, the two are the same. `e.localTo(node)` resolves through that node's own view, so it is correct with either kind of event:

```ts
engine.events.on('pointerMove', (e) => {
  const p = e.localTo(hudPanel) // correct under a screen layer, at any zoom
})
```

Passing a stage event's `pointer.world` to `worldToLocal` of a node under a layer gives a position in the wrong space. In development, this logs a warning once per node that points to `localTo`.

### Touch slop

Touch slop grows every hit target by a margin so a fingertip hits small nodes. [`touchSlopScreen`](/module/input/inputsystem#touchslopscreen) is that margin in CSS pixels, 30 by default. Change it with `setTouchSlopScreen`:

```ts
engine.input.setTouchSlopScreen(20)
```

The hit test converts the slop into each node's world units as it goes, so it stays the same size on screen at any zoom. `touchSlopWorld` gives it in the active camera's world units. [`touchSlopFor(node)`](/module/input/inputsystem#touchslopfor) gives it for the view that places a node, which is the one to use under a layer. A node can grow its own target further in `hitTest`, for example a {@link Path2DNode} with `hitMode: 'circle'` and a large `hitRadiusWorld`.

### Destroyed nodes and lost capture

Destroying a node that holds a pointer emits a `pointerCancel` with `e.source === 'synthetic'` on the stage's bus and releases the capture. The destroyed node's own handlers do not run. A behavior that tracks a press, such as a {@link PointerBehavior} subclass, is detached in the same destroy, and cleans up in `onDetach` or `onPointerDetach`.

If the browser fires `lostpointercapture` for a pointer the system still holds, the input system treats it as a native cancel. The captured node's `onPointerCancel` runs with `e.source === 'native'`, the capture is released, and the pointer leaves `pointers`. `input.releaseCapture(pointerId)` releases a node's capture from code without sending a cancel.

### Browser gestures

Every stage sets `touch-action: none`, `user-select: none`, `-webkit-user-select: none`, `-webkit-touch-callout: none` and `outline: none` on its canvas. The input system also blocks the `contextmenu` event, so a long press does not open a menu. Together these stop pinch-zoom, text selection, the touch callout and the context menu on the canvas. Elements outside the canvas need their own handling.

## See also

- {@link InputSystem}: per-stage pointer tracking and touch slop
- {@link PointerEvent2D}: the event every handler receives
- {@link PointerHandlers}: the options of `bindPointer`
- {@link PointerBehavior}: a base class for input behaviors
- {@link ButtonBehavior}: a tap button
- {@link HoldButtonBehavior}: a button that fires on press and repeats
- {@link DraggableBehavior}: drag and drop
- {@link bindRegionGesture}: a gesture on an area of the stage
- {@link EngineEvents}: the engine's event map
- [Scene graph](/guides/scene): hit testing and layers
- [Camera](/guides/camera): the view that turns screen positions into world positions
- [Stages](/guides/stages): input on more than one canvas

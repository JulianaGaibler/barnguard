# Stages

A `Stage` is one render surface: a canvas plus its own `Renderer`, `Scene`, `Camera`, and `Layers`. `Engine` owns a `primaryStage` for its own canvas, and any number of secondary stages attach via `engine.attachStage(canvas, opts)` to render additional scenes into other canvases while sharing the ticker and animator.

## When to reach for a secondary stage

The motivating case is an overlay that hosts a small `<canvas>`, such as a card that plays its own animation on top of the main game. The alternative, a second `EngineHost`, brings a second rAF loop, a second `InputSystem`, and two wall clocks that drift. A secondary stage avoids all of that.

Use one whenever you want a separate render surface on the same simulation clock.

## Attach a stage

```ts
import type { Engine, Stage, StageOptions } from '@src/stargazer'

const stage: Stage = engine.attachStage(canvasEl, {
  initialViewport: { x: -100, y: -100, width: 200, height: 200 },
})
```

`StageOptions`:

- `initialViewport?: Rect`. World-space rect the camera frames. Defaults to 1000×1000.
- `clearColor?: string`. Solid color used when `transparent` is false.
- `transparent?: boolean`. Defaults to `true` for secondary stages, so the parent element's background shows through. Set it false and supply `clearColor` for an opaque secondary.
- `interactive?: boolean`. Attach an `InputSystem` so nodes here receive pointer events. Defaults to `false` for secondaries; the primary always has input on.
- `name?: string`. A label used by dev tooling.

`attachStage` throws if the canvas is already attached, including the primary canvas. One stage per canvas.

## Interactive secondaries

Pass `interactive: true` and the stage's canvas gets its own multi-touch pipeline: `setPointerCapture` on down, a per-node hit walk of that stage's scene, world reprojection via that stage's active camera, and the same `onPointerDown/Move/Up/Cancel` hooks on scene nodes.

```ts
const stage = engine.attachStage(cardCanvas, {
  interactive: true,
  initialViewport: { x: -120, y: -80, width: 240, height: 160 },
})
const marker = new ShapeNode({
  geometry: { kind: 'circle', radius: 14 },
  fill: '#c084fc',
})
marker.hitEnabled = true
marker.onPointerDown = (e) => {
  /* start drag */
}
marker.onPointerMove = (e) => {
  marker.transform.x = e.pointer.world.x
  marker.transform.y = e.pointer.world.y
}
stage.scene.root.add(marker)
```

`stage.events: Emitter<StagePointerEvents>` fires `pointerDown/Move/Up/Cancel` for that stage only. Nothing from a secondary stage reaches `engine.events`; the primary's events forward there for backward compatibility, so a tap on a secondary can't trigger the main game's global handlers. See [Input](/guides/input#per-stage-event-bus-vs-engineevents).

Browser pointer capture is per element and per pointer, so a finger dragging on the primary and another on a secondary work at the same time; each canvas owns its own capture. A pointer that goes down on one canvas keeps its capture there even if it slides onto another; cross-stage capture is not supported.

## Detach a stage

```ts
engine.detachStage(stage)
```

`detachStage` cascades: `stage.scene.root.destroy()` aborts every node's `abortSignal` (in-flight tweens reject with `AbortError`), the `ResizeObserver` disconnects, the offscreen static-layer buffer releases, and the canvas frees its slot so you can reattach later. `engine.destroy()` disposes every secondary stage first, then the primary.

## The `mountStage` Svelte action

For overlay components, `mountStage` mirrors `mountEngine`: attach on mount, detach on unmount.

```svelte
<script lang="ts">
  import { mountStage, type Stage } from '@src/stargazer'
  import type { Engine } from '@src/stargazer'

  const { engine }: { engine: Engine } = $props()

  function buildScene(stage: Stage): void {
    // build nodes on stage.scene.root
  }
</script>

<canvas
  use:mountStage={{
    engine,
    options: { initialViewport: { x: -100, y: -100, width: 200, height: 200 } },
    onReady: buildScene,
  }}
></canvas>
```

When Svelte destroys the component, the action calls `engine.detachStage(stage)`. No manual `onDestroy` boilerplate.

## Sharing assets across stages

`Path2D` objects, `BitmapMask` instances, and sprite images are plain JS data. Reuse them across stages:

```ts
const svgPaths = await parseSvgPaths(svgSource)

// Primary scene.
engine.scene.root.add(new Path2DNode({ path: svgPaths.root.path, ... }))

// A secondary stage reuses the same Path2D in a different node.
function buildScene(stage: Stage): void {
  stage.scene.root.add(new Path2DNode({ path: svgPaths.root.path, ... }))
}
```

Assets are immutable data; stages own scene nodes.

## Shared clock

Every `.tween` / `.wait` / `.animate` advances from the same `Animator` each frame. A tween on a secondary-scene node ticks in the same frame as tweens on the primary, at the same `dt`:

```ts
engine.tween(primaryNode.transform, { x: 700 }, { duration: 2 })
engine.tween(secondaryNode.transform, { x: 100 }, { duration: 2 })
// Both reach their end at the same instant.
```

## What secondaries don't get

A secondary stage has no `InputSystem` unless constructed with `interactive: true`; without it, `stage.input === null` and pointer events on that canvas are ignored. Even an interactive secondary emits pointer events only on `stage.events`, never on the engine bus. `Behavior.onFixedStep` fires only on primary-scene behaviors, so secondary scenes are `onUpdate`-only. Context-loss recovery is app-owned on the primary; a secondary that loses its context recovers via `stage.reacquireContext()`, or you detach and reattach it. And `resize` fires for the primary canvas only: a secondary rescales its own backing store and invalidates its static bake internally, so game code doesn't need to know when that happens.

## DPR and resize

Every stage runs the same DPR pipeline. A `ResizeObserver` plus a `window.resize` listener detect changes; on any change the stage reads the canvas rect and `devicePixelRatio`, sets the backing store to `cssSize × dpr`, recomputes the camera's uniform fit, and marks the static layer for a rebake. The baseline transform handles crisp rendering at any DPR, so callers don't do any of this math.

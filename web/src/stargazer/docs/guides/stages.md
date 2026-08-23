# Stages

A `Stage` is one render surface: a canvas, its own scene tree, its own cameras,
and the render target it draws into. `Engine` owns a `primaryStage` for its own
canvas. Any number of secondary stages attach with
`engine.attachStage(canvas, opts)` and render other scenes into other canvases
while sharing the ticker and the animator.

## When to reach for one

The motivating case is a second `<canvas>` somewhere in the page: a card that
plays its own animation over the main game, a tutorial mini-view, a preview
panel. The alternative, a second `EngineHost`, brings a second rAF loop, a second
input pipeline, and two clocks that drift apart. A secondary stage avoids all of
that.

Reach for one whenever you want a separate render surface on the same simulation
clock.

## Attach a stage

```ts
import { CameraNode2D, ShapeNode } from '@src/stargazer'

const stage = engine.attachStage(canvasEl, { name: 'card' })

const cam = new CameraNode2D()
cam.setViewport({ x: -120, y: -80, width: 240, height: 160 })
stage.tree.root.add(cam)
cam.makeCurrent()

stage.tree.root.add(
  new ShapeNode({ geometry: { kind: 'circle', radius: 14 }, fill: '#c084fc' }),
)
```

A stage has its own tree at `stage.tree` and no camera until you add one, exactly
like the primary. Until a camera is current the canvas shows only the clear
color.

`StageOptions`:

- `clearColor?: string`. Solid clear used when `transparent` is false.
- `transparent?: boolean`. Default false. Set it true to clear to zero alpha so
  the parent element's background shows through.
- `interactive?: boolean`. Default false for secondaries. Attaches an
  `InputSystem` so nodes on this stage receive pointer events. The primary is
  always interactive.
- `msaaSamples?: number`. Defaults to the engine's count.
- `physics?: boolean | PhysicsWorldConfig`. Gives this stage its own world. See
  [Physics](/guides/physics).
- `name?: string`. Label in the debug HUD's stage selector.
- `onResize?: (info) => void`. Fires after the stage has resized its backing
  store and re-fitted its cameras.

`attachStage` throws if the canvas is already attached, the primary canvas
included. One stage per canvas.

## Interactive secondaries

Pass `interactive: true` and the stage's canvas gets its own multi-touch
pipeline: pointer capture on press, a per-node hit walk of that stage's tree,
world reprojection through that stage's active camera, and the same
`onPointerDown` / `Move` / `Up` / `Cancel` hooks on nodes.

```ts
const stage = engine.attachStage(cardCanvas, { interactive: true })

const marker = new ShapeNode({
  geometry: { kind: 'circle', radius: 14 },
  fill: '#c084fc',
})
marker.bindPointer({
  singlePointer: true,
  move: (e) => {
    marker.transform.x = e.pointer.world.x
    marker.transform.y = e.pointer.world.y
  },
})
stage.tree.root.add(marker)
```

`stage.events` fires `pointerDown` / `Move` / `Up` / `Cancel` for that stage
only. Nothing from a secondary reaches `engine.events`, so a tap on a card canvas
cannot trigger the main game's global handlers. The primary's events do forward
to the engine bus. See [Input](/guides/input#per-stage-event-bus-vs-engineevents).

Browser pointer capture is per element and per pointer, so a finger dragging on
the primary and another on a secondary work at the same time. A pointer that goes
down on one canvas keeps its capture there even if it slides onto another.
Cross-stage capture is not supported.

## Parking a stage

`stage.setActive(false)` takes a stage out of the frame entirely: its tree is not
walked, its transforms are not propagated, and it is not rendered. Flipping it
back to true resumes instantly with no re-initialization and no context churn.
That is what makes a pre-warmed stage cheap to keep around, such as a tutorial
canvas that stands ready while a game plays.

One catch. Physics worlds step from the engine's global registry, not per stage,
so a parked stage's bodies keep simulating. Clear its scene, which unregisters
the world, before parking it.

## Detach a stage

```ts
engine.detachStage(stage)
```

Detaching destroys the stage's tree (every node's `abortSignal` fires and
in-flight tweens reject with `AbortError`), tears down its input system,
disconnects its `ResizeObserver`, and frees the canvas so it can be reattached
later. `engine.destroy()` disposes every secondary first, then the primary.

## The mountStage Svelte action

For overlay components, `mountStage` mirrors `mountEngine`: attach on mount,
detach on unmount.

```svelte
<script lang="ts">
  import { mountStage, CameraNode2D } from '@src/stargazer'
  import type { Engine, Stage } from '@src/stargazer'

  const { engine }: { engine: Engine } = $props()

  function buildScene(stage: Stage): void {
    const cam = new CameraNode2D()
    cam.setViewport({ x: -100, y: -100, width: 200, height: 200 })
    stage.tree.root.add(cam)
    cam.makeCurrent()
    // ...build the rest on stage.tree.root
  }
</script>

<canvas
  use:mountStage={{
    engine,
    options: { transparent: true },
    onReady: buildScene,
  }}
></canvas>
```

When Svelte destroys the component the action calls `engine.detachStage(stage)`.
No manual `onDestroy` boilerplate.

## Sharing assets across stages

A `Path2D`, a `BitmapMask`, and an image are plain data with no device handles,
so the same instance backs nodes on any stage. Tessellation registrations are
process-wide too. Assets are immutable data, and stages own nodes.

```ts
const { paths } = parseSvgPaths(svgSource, { tessellate: true })
const shape = paths.get('badge')!.path

engine.tree.root.add(new Path2DNode({ path: shape, fill: '#88c' }))
stage.tree.root.add(new Path2DNode({ path: shape, fill: '#fff' }))
```

Each stage keeps its own texture atlas and label page, though, so a label drawn
on two stages is rasterized twice.

## What is shared and what is not

Shared: the `Ticker` (one rAF loop drives every stage), the `Animator`, and the
pause flag. A tween on a secondary node ticks in the same frame at the same `dt`
as one on the primary, so two animations across two canvases stay in lockstep.

```ts
engine.tween(primaryNode.transform, { x: 700 }, { duration: 2 })
engine.tween(secondaryNode.transform, { x: 100 }, { duration: 2 })
// Both land on the same frame.
```

`onFixedStep` runs on every active stage, so a behavior on a secondary integrates
just like one on the primary. Keep that work cheap when several stages are
attached.

Not shared: the scene tree, the cameras, the render target, the texture caches,
and the input system. The engine's `resize` event fires for the primary canvas
only. A secondary resizes its own backing store and re-fits its own cameras, and
reports it through `StageOptions.onResize` if you want to know.

## DPR and resize

Every stage runs the same pipeline. A `ResizeObserver` plus a `window.resize`
listener detect changes. On a change the stage reads the canvas rect and
`devicePixelRatio`, sizes the backing store to `cssSize * dpr`, resizes its
render target, and re-fits every registered camera. The device-pixel baseline
transform keeps rendering crisp at any DPR, so callers do none of this math.

## Context loss

Recovery is app-owned on the primary, where the host runs its retry ladder (see
[Engine setup](/guides/setup#context-loss)). A secondary that loses its context
recovers through `stage.reacquireContext()`, or by detaching and reattaching it.

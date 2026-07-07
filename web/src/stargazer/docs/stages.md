# Stages

A `Stage` is one render surface; one canvas plus its own `Renderer`, `Scene`, `Camera`, and `Layers`. The `Engine` owns a `primaryStage` for its own canvas; any number of secondary stages can attach via `engine.attachStage(canvas, opts)` to render additional scenes into other canvases while sharing the ticker and the animator.

## When to reach for a secondary stage

The booth's game-over card is the motivating case: a Svelte overlay contains a small `<canvas>` (~400×400 CSS px) that plays a zoomed-in loss animation using the same particle system and SVG-derived assets the main game uses. It lives inside an HTML card, with the primary game canvas behind it.

The obvious alternative; a second `EngineHost`; has real costs: a second rAF loop, a second `InputSystem`, a second `DebugController`, and two wall clocks that drift. A secondary stage skips all of that.

Use one whenever you want a separate render surface but the same simulation clock.

## Attach a stage

```ts
import type { Engine, Stage, StageOptions } from '@src/stargazer'

const stage: Stage = engine.attachStage(canvasEl, {
  initialViewport: { x: -100, y: -100, width: 200, height: 200 },
})
```

`StageOptions` fields:

- `initialViewport?: Rect`. World-space rect the camera frames. Default 1000×1000.
- `clearColor?: string`. Solid color used when `transparent` is false.
- `transparent?: boolean`. Defaults to `true` for secondary stages (the parent HTML card's background shows through). Set false + supply `clearColor` for an opaque secondary.
- `interactive?: boolean`. Attach an `InputSystem` so nodes here can receive pointer events. Default `false` for secondaries (display-only); the primary is always constructed with input on. See [Interactive secondaries](#interactive-secondaries).
- `name?: string`. Label surfaced in the debug HUD stage selector.

`attachStage` throws if the canvas is already attached (including the primary canvas); one stage per canvas.

## Interactive secondaries

Pass `interactive: true` and the stage's canvas gets its own multi-touch input pipeline: `setPointerCapture` on down, per-node hit-walk of that stage's scene, continuous world reprojection via that stage's active camera, and the same `onPointerDown/Move/Up/Cancel` hooks on scene nodes.

```ts
const stage = engine.attachStage(cardCanvas, {
  interactive: true,
  initialViewport: { x: -120, y: -80, width: 240, height: 160 },
})
const packet = new ShapeNode({
  geometry: { kind: 'circle', radius: 14 },
  fill: '#c084fc',
})
packet.hitEnabled = true
packet.onPointerDown = (e) => {
  /* start drag */
}
packet.onPointerMove = (e) => {
  packet.transform.x = e.pointer.world.x
  packet.transform.y = e.pointer.world.y
}
packet.onPointerUp = () => {
  /* decide win / reset */
}
stage.scene.root.add(packet)
```

**Per-stage event emitter.** `stage.events: Emitter<StagePointerEvents>` fires `pointerDown/Move/Up/Cancel` for that stage only. **Nothing goes to `engine.events` from a secondary stage.** The primary's events forward to `engine.events` so existing code that listens `engine.events.on('pointerDown', ...)` continues to work; a tap on a secondary card can't accidentally trigger the main game's global handlers. See [`docs/input.md`](./input.md#per-stage-event-bus-vs-engineevents) for the fuller explanation.

**Multi-touch across canvases.** Browser pointer capture is per-element and per-pointerId, so one finger dragging on the primary and another on the secondary work simultaneously; each canvas owns its own capture, no confusion.

**Cross-stage capture is not supported.** A pointer that goes `down` on the primary and slides onto the secondary keeps its capture on the primary. This matches M5's bezel-drag semantics; capture stays with the original target until it's released.

**Debug camera integration.** When the debug HUD's active stage is a secondary and its debug camera is toggled on, the secondary's `InputSystem` reprojects through the debug camera. A shape being dragged stays under the finger while `WASD` pans the debug view.

## Detach a stage

```ts
engine.detachStage(stage)
```

`detachStage` cascades: `stage.scene.root.destroy()` aborts every node's `abortSignal` (any in-flight tweens on that scene reject with `AbortError`), the `ResizeObserver` disconnects, the offscreen static-layer canvas releases, and the canvas frees its one-per slot so you can reattach later. When the engine itself is destroyed, `engine.destroy()` disposes every attached secondary stage first, then the primary.

## The `mountStage` Svelte action

For overlay components, `mountStage` mirrors `mountEngine`; attach on mount, detach on unmount:

```svelte
<script lang="ts">
  import { mountStage, type Stage } from '@src/stargazer'
  import type { Engine } from '@src/stargazer'

  const { engine }: { engine: Engine } = $props()

  function buildLossScene(stage: Stage): void {
    // build particles + shapes on stage.scene.root using shared assets
  }
</script>

<canvas
  use:mountStage={{
    engine,
    options: { initialViewport: { x: -100, y: -100, width: 200, height: 200 } },
    onReady: buildLossScene,
  }}
></canvas>
```

When Svelte destroys the component, the action calls `engine.detachStage(stage)`. No manual `onDestroy` boilerplate; no leak paths.

## Sharing assets across stages

`Path2D` objects, `BitmapMask` instances, sprite images; all of these are plain JS objects. Reuse them across stages:

```ts
// Load once, at app boot.
const svgPaths = await parseSvgPaths(deStatesSvg)
const mask = await buildBitmapMask({ path: svgPaths.root.path, worldRect: {...} })

// Primary scene uses them.
const primary = new Path2DNode({ path: svgPaths.root.path, ... })
engine.scene.root.add(primary)

// Loss card uses the same Path2D; just a different node in a different scene.
function buildLossScene(stage: Stage): void {
  const echo = new Path2DNode({ path: svgPaths.root.path, ... })
  stage.scene.root.add(echo)
}
```

Assets are immutable data; stages own scene nodes.

## Shared clock

`engine.animation.tween(...)` (and every `.tween` / `.wait` / `.animate` shortcut) advances from the same `Animator` on every frame. A tween running on a secondary-scene node's transform ticks in the same frame as tweens on the primary, at exactly the same `dt`. Kicking two tweens simultaneously; one on each stage's hero node; is the sync test.

```ts
engine.tween(
  primaryHero.transform,
  { x: 700 },
  { duration: 2, easing: easings.inOutQuad },
)
engine.tween(
  secondaryHero.transform,
  { x: 100 },
  { duration: 2, easing: easings.inOutQuad },
)
// Both reach their end at the same instant.
```

The `?demo=stages` route exercises this end-to-end.

## Debug HUD support

Passing `name: 'Loss Card'` in `StageOptions` labels the stage in the debug HUD's stage selector; a chip strip at the top of the panel. Tapping the chip retargets stage-scoped sections (Coordinates, Camera, Scene, Scene tree, Camera pad) and overlays (Grid, Outlines, Debug camera) to that stage. Global sections (Performance, Pause) don't change. Pointer sections stay primary-only since input isn't wired to secondaries.

When the selected stage is detached (Svelte destroys the loss card, or the game calls `engine.detachStage`), the HUD auto-reverts to Primary within one RAF poll. See [`debug.md`](./debug.md#stage-selector) for the full behavior.

## What secondaries do NOT get

- **`InputSystem` by default.** Opt in with `interactive: true`; without it, `stage.input === null` and pointer events on that canvas are ignored (display-only). See [Interactive secondaries](#interactive-secondaries).
- **Engine-bus pointer events.** Even interactive secondaries emit only on `stage.events`, not `engine.events`. The primary's events forward to `engine.events` for backwards compat. Listen on the specific `stage.events` to receive that stage's input.
- **Debug overlay drawn on top of them by default.** Node outlines / grid / game-camera pip only draw on the _active_ stage; flip the chip strip to the secondary to inspect it. Pointer overlay draws on every stage that has an `InputSystem` (so multi-touch is visible on whichever canvas the finger touches).
- **`onFixedStep`.** `Behaviour.onFixedStep` fires only on primary-scene behaviours. Loss animations are `onUpdate`-only (particles + tweens with variable `dt`), which is fine.
- **`contextlost` auto-reload.** The kiosk `location.reload()` recovery is primary-only. A secondary that loses its context recovers via `stage.reacquireContext()` (attach a `contextlost` listener on the canvas yourself), or the app can just detach and re-attach on next open.
- **`ready` / `resize` engine events.** The `resize` event fires only for the primary canvas. If a secondary's canvas resizes, `Stage` handles it internally (rescales backing store, invalidates the static bake); game code doesn't need to know.

## DPR + resize checklist

Every stage; primary and secondary; runs the same DPR pipeline:

1. `ResizeObserver` on the canvas + a `window.resize` listener.
2. On any change: read `canvas.getBoundingClientRect()` → `cssW, cssH`; read `window.devicePixelRatio` → `dpr`.
3. Bail if `(cssW, cssH, dpr)` unchanged.
4. `renderer.resize(cssW, cssH, dpr)` sets `canvas.width = cssW * dpr; canvas.height = cssH * dpr`.
5. `camera.setPixelSize(cssW, cssH)`; world-fit recomputes its uniform scale.
6. The offscreen static-layer canvas is marked for rebake (pixel size changed).
7. On the next `render`, `renderer.clear()` sets `ctx.setTransform(1, 0, 0, 1, 0, 0)` first; per-layer draws compose the DPR-scaled world-to-screen transform on top.

On a 4K display at `dpr = 1.5`, a card at 400×400 CSS px gets a 600×600 backing store, and the same baseline transform handles crisp rendering. No math changes needed on the caller; because `Stage` uses the same code path as the primary Engine used to.

## Full lifecycle example

```ts
// somewhere in app boot; the primary is already up
import type { EngineHost, Stage } from '@src/stargazer'

async function showLossCard(host: EngineHost): Promise<void> {
  // Svelte renders the card, which owns the <canvas>. Assume `cardCanvas` is
  // the ref you got from bind:this or the mountStage action.
  const stage = host.engine.attachStage(cardCanvas, {
    initialViewport: { x: -100, y: -100, width: 200, height: 200 },
  })

  // Build the scene using the same assets the primary uses.
  buildLossScene(stage, sharedAssets)

  // ...user taps "Continue" in the card...
  host.engine.detachStage(stage)
}
```

If you're wiring through `mountStage`, the attach + detach are automatic; the block above is only for cases where you construct the stage outside a Svelte component lifecycle.

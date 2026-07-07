# Scene graph

A `Scene` belongs to a `Stage`; the primary Engine has one and each `engine.attachStage(...)` returns a stage with its own. Everything below applies per stage: `engine.scene` is a shortcut for the primary; secondary stages get their scene via `stage.scene`. See [`stages.md`](./stages.md) for how to attach a second canvas.

## SceneNode

Everything in the scene is a `SceneNode`. Concrete primitives extend it:

- `GroupNode`. Transform-only container, no visual.
- `ShapeNode`. Circle or rect, optional fill + stroke. Circles hit-test as circles; rects fall back to AABB.
- `Path2DNode`. Arbitrary `Path2D` fill/stroke, hit-tests via `isPointInPath` (or a bounding circle when `hitMode: 'circle'`).
- `PolylineNode`. Append-only Float32Array-backed polyline, optional quadratic-Bézier smoothing.
- `ParticleEmitterNode`. See [`particles.md`](./particles.md).

Composition happens through `parent.add(child)` / `parent.remove(child)`. Root is `scene.root`; the Engine creates the Scene and adds it back to itself, so `host.loadScene((scene, engine) => scene.root.add(...))` is enough.

## Transforms

`node.transform` is a `Transform2D`; a decomposed 2D affine with getters/setters for `x`, `y`, `scaleX`, `scaleY`, `rotation` (radians), `originX`, `originY`, and `alpha`. Every setter marks the local matrix dirty; the tree walk in `Engine.frame()` recomputes `local` when dirty and always recomputes `world = parent.world × local`.

You almost always want:

```ts
node.transform.x = 100
node.transform.y = 200
node.transform.rotation = Math.PI / 4
node.transform.alpha = 0.5
```

For per-frame animation, prefer `node.tween(...)` over manual per-step mutation; see [`animation.md`](./animation.md).

`node.transform.world` is a `DOMMatrix` filled in by the engine's transform propagation pass. Read it in a `draw` override or a `hitTest` implementation; don't write to it directly.

## Behaviour

`Behaviour` is the way game logic attaches to a node. Extend it and override any of `onAttach`, `onDetach`, `onUpdate(dt)`, `onFixedStep(fixedDt)`:

```ts
import { Behaviour } from '@src/stargazer'

class SpinBehaviour extends Behaviour {
  constructor(private radPerSec: number) { super() }
  onUpdate(dt: number): void {
    this.node.transform.rotation += this.radPerSec * dt
  }
}

const node = new ShapeNode({ ... })
node.addBehaviour(new SpinBehaviour(0.5))
```

Behaviours reach the node they're attached to via `this.node`. Between attach and detach, `this.node` is always the owning `SceneNode`.

Look up behaviours by class:

```ts
const spin = node.getBehaviour(SpinBehaviour)
if (spin) spin.radPerSec *= 2

const allDamping = node.getBehaviours(DampingBehaviour)
```

Both use `instanceof` under the hood, so subclasses match.

`onFixedStep` runs at 120 Hz (configurable via `EngineHostOptions.fixedStepHz`), inside the accumulator loop, capped at 8 iterations per frame. Use it for anything that needs to be independent of render dt; collision detection, physics integration. Use `onUpdate` for everything else.

## Async lifecycle scoped to nodes

Every `SceneNode` has a private `AbortController`. `node.abortSignal` is public and read-only. `node.destroy()`:

1. Marks the node destroyed.
2. Destroys every child first (bottom-up, aborts each child's signal on the way up).
3. Detaches every behaviour.
4. Aborts its own AbortController.
5. Emits the `'destroy'` event on `node.events`.
6. Removes the node from its parent.

Anything scoped to `node.abortSignal`; every `node.tween(...)`, `node.wait(...)`, or `node.animate(...)`; rejects with `AbortError` when the node dies. Use `ignoreAbort` in a `.catch(...)` to swallow it cleanly:

```ts
import { ignoreAbort } from '@src/stargazer'

await node
  .tween({ alpha: 0 }, { duration: 0.5, easing: easings.outCubic })
  .catch(ignoreAbort)
```

More on the abort contract in [`animation.md`](./animation.md).

## Hit testing

An `InputSystem` walks the scene back-to-front on `pointerdown` and finds the topmost node with `hitEnabled === true` whose `hitTest(worldX, worldY, touchSlopWorld)` returns true. That node captures the pointer at both the node level (subsequent move/up/cancel dispatch there) and the DOM level (`canvas.setPointerCapture`).

Each concrete node type provides its own hit-test:

- `ShapeNode`. Circles use `distance² ≤ (radius + slop)²` in local coords; rects use the AABB via `debugBounds`.
- `Path2DNode`. `hitMode: 'fill' | 'stroke' | 'circle' | 'none'`. `'fill'` and `'stroke'` transform the world point into local coords and use a shared 1×1 scratch context to call `isPointInPath` / `isPointInStroke`. `'circle'` is a cheap radius check against `hitRadiusWorld`.
- Base `SceneNode`. AABB via `node.debugBounds` (or false if `debugBounds` is null).

Override `hitTest` in a subclass if you need something else. World-space in, boolean out.

See [`input.md`](./input.md) for the rest of the input pipeline.

## Render layers and the static bake

`node.renderLayer` picks one of three passes:

- `'static'`. Baked once into an offscreen buffer, blitted each frame. Use for content that changes rarely (the map). The bake is sealed into an immutable `ImageBitmap` (`Layers`) rather than blitting a live `<canvas>`; Firefox reads back a live source canvas on every blit (~33 MB at 4K), so the bitmap keeps the per-frame blit a cheap GPU texture draw. Falls back to a plain-canvas blit where `OffscreenCanvas.transferToImageBitmap` is unavailable.
- `'above-static'`. Drawn per frame between the static blit and the dynamic pass. Sits above map, below packets/particles.
- `'dynamic'` (default). Drawn per frame on top.

Setting `renderLayer` to or from `'static'` calls `scene.invalidateStatic()`. On the next stable-camera frame the renderer re-bakes the static tree. Setting `renderLayer` between the two non-static values costs nothing.

The renderer skips the cache when the camera moved between the previous frame and this one; for a `Camera.animateTo` tween, that's every frame. During the tween the static tree renders fresh each frame; on settle, the first stable frame bakes once. The `Static bakes/s` HUD row (in `?debug=hud`) reads 0 in steady state.

### Animating a static node

Don't mutate properties of a static node while it's on the static layer; the cache doesn't know to re-bake, and later frames will blit stale content. The pattern is: promote → animate → demote:

```ts
async function pulse(state: SceneNode, signal: AbortSignal): Promise<void> {
  state.renderLayer = 'above-static' // triggers one bake without the state
  try {
    await state.tween(
      { alpha: 0.7 },
      { duration: 0.2, easing: easings.outCubic, signal },
    )
    await state.tween(
      { alpha: 1.0 },
      { duration: 0.4, easing: easings.inOutQuad, signal },
    )
  } finally {
    state.renderLayer = 'static' // triggers one bake with the state back
  }
}
```

Two bakes total for the whole pulse. The `?demo=camera` demo has this wired to the `P` key so you can verify the bake count in the HUD.

### Z-order

Within a layer, draw order follows scene-tree DFS pre-order; parents draw first, then children, then next sibling. Between layers, static → above-static → dynamic → debug overlay. A promoted static node ends up above the map but below anything on `'dynamic'`.

## Dynamic resolution

A stage can decouple its **render** resolution from its **display** resolution to trade sharpness for pixel throughput; essential on the 4K kiosk, where clear + blit + fresh vector re-raster + composite are all pixel-bound. Enable it per stage via `dynamicResolution` (on `EngineOptions` for the primary; secondary stages stay at native). The `DynamicResolution` controller decides a `renderScale ∈ (0,1]` each frame:

- **During camera motion** it drops to `motionScale` (~0.55); the motion masks the softness. On settle it holds the low scale for a short dwell (so tap-spamming a zoom target doesn't thrash the backing-store resize), then ramps back up over a few frames (a staggered step-up hides the sharpness "pop").
- **An adaptive governor** watches an EMA of the RAW frame time (not the clamped `dt`, which would hide misses above the clamp) and steps a steady-state baseline down/up with a hysteresis deadband; a safety net for overload that isn't a camera move. It's gated off during motion.

`Stage.setRenderScale` resizes the backing store and invalidates the static bake (so it re-bakes at the new size), but deliberately does **not** fire `onResize`; the CSS layout and world viewport are unchanged. The HUD's `Render scale` and `Active bitmaps` rows (`?debug=hud`) surface the live scale and the bake-bitmap leak guard.

### Viewport culling

`drawLayer` skips any node whose world-space AABB (from `debugBounds`, inflated by the node's stroke half-width) lies fully outside the **visible** world rect; derived from the canvas corners via `screenToWorld`, so it includes the letterbox margin. Nodes without `debugBounds` always draw. Biggest win on the fresh-draw during a zoom-in, where only the few states inside the framing get rasterized.

## Stroke widths and camera zoom

Every stroke-capable primitive; `ShapeNode`, `Path2DNode`, `PolylineNode`; treats `lineWidth` as **CSS pixels** by default. When the camera zooms in (viewport shrinks) the stroke stays visually the same thickness: the number of device pixels tracks the DPR baseline, not the camera scale.

If you want the stroke to scale with the world; a "highway" that gets thicker as the camera zooms in, or a shockwave halo whose ring width is a physical part of the game world; opt into the world-space behaviour per node:

```ts
import { Path2DNode } from '@src/stargazer'

const highway = new Path2DNode({
  path,
  stroke: '#ffd34d',
  lineWidth: 8,
  strokeSpace: 'world', // ← scales with camera zoom (old behaviour)
})
```

The default (`strokeSpace: 'screen'`) mirrors how CSS `stroke-width` behaves under an SVG viewport transform. Nodes that override `draw` themselves can call `camera.strokeSpaceScale()` and multiply their raw CSS-px lineWidth (and any dash entries) by the returned scalar; the recipe is `ctx.lineWidth = cssPx * camera.strokeSpaceScale()`. See [`camera.md`](./camera.md#stroke-space-scale) for the maths.

## Scene lifecycle

`host.loadScene(builder)` destroys the current children of `scene.root` and calls `builder(scene, engine)` to populate. Do all your one-time scene construction there:

```ts
await host.loadScene((scene, engine) => {
  const map = new GroupNode('map')
  map.renderLayer = 'static'
  scene.root.add(map)

  for (const [id, entry] of stateAssets.paths) {
    const state = new Path2DNode({
      path: entry.path,
      fill: '#354a6e',
      hitMode: 'fill',
    })
    state.renderLayer = 'static'
    map.add(state)
  }
})
```

`host.destroy()` recursively destroys `scene.root`; every node's `abortSignal` fires, every pending tween rejects, every behaviour detaches.

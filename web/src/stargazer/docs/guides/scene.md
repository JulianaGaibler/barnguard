# Scene graph

A `SceneTree` belongs to a `Stage` and holds one tree of both 2D (`Node2D`) and 3D (`Node3D`) nodes, rooted at `tree.root`. The primary engine has one, and each `engine.attachStage(...)` returns a stage with its own. Everything below applies per stage: `engine.tree` is a shortcut for the primary; secondary stages get theirs via `stage.tree`. See [Stages](/guides/stages) for how to attach a second canvas.

## Node2D

Everything in the scene is a `Node2D`: a transform, a parent, children, and optional behaviors. Use it directly as a transform-only container to group children. The drawable primitives extend it:

- `ShapeNode`, a circle or rect with optional fill and stroke. Circles hit-test as circles; rects fall back to their bounding box.
- `Path2DNode`, an arbitrary `Path2D` fill or stroke. It hit-tests via `isPointInPath`, or a bounding circle when `hitMode: 'circle'`.
- `PolylineNode`, an append-only polyline backed by a `Float32Array`, with optional quadratic-Bézier smoothing.
- `TextNode`, a run of text rasterized to a glyph texture. See its API reference for options.
- `ParticleEmitterNode`. See [Particles](/guides/particles).

Composition happens through `parent.add(child)` and `parent.remove(child)`. The root is `scene.root`, and the engine adds the scene to itself, so `host.loadScene((scene, engine) => scene.root.add(...))` is enough.

## Reusable subtrees

A subtree is the unit of reuse. There's no separate scene or prefab type: to reuse a chunk of the tree, write a function that builds and returns it, then call it wherever you need a copy. A builder can call other builders, so a `buildArena()` can compose a `buildOrb()`, and calling it twice gives two independent instances.

```ts
function buildArena(): Node2D {
  const arena = new Node2D('arena')
  arena.add(buildOrb())
  return arena
}
scene.root.add(buildArena())
scene.root.add(buildArena())
```

Attach behaviors in the builder to make the subtree self-contained: a behavior wires itself up when the subtree is added to a scene and tears itself down when the node is destroyed. A `PhysicsWorldBehavior`, for example, gives the subtree its own physics world (see [Physics](/guides/physics)), so two arenas simulate independently with nothing else to coordinate.

A node can also drive an HTML element: attach one so the engine keeps it flush with the canvas as the camera moves. See [HTML overlays](/guides/html-overlays).

## Transforms

`node.transform` is a `Transform2D`, a decomposed 2D affine with getters and setters for `x`, `y`, `scaleX`, `scaleY`, `rotation` (radians), `originX`, `originY`, and `alpha`. Every setter marks the local matrix dirty. The tree walk in `Engine.frame()` rebuilds `local` when dirty and recomputes `world = parent.world × local`.

Most code sets the properties directly:

```ts
node.transform.x = 100
node.transform.y = 200
node.transform.rotation = Math.PI / 4
node.transform.alpha = 0.5
```

For animation, prefer `node.tween(...)` over per-frame mutation. See [Animation](/guides/animation).

`node.transform.world` is a `DOMMatrix` filled in by the transform-propagation pass. Read it in a `draw` or `hitTest` override; don't write to it directly.

## Behavior

`Behavior` attaches game logic to a node. Extend it and override any of `onAttach`, `onDetach`, `onUpdate(dt)`, `onFixedStep(fixedDt)`:

```ts
import { Behavior } from '@src/stargazer'

class SpinBehavior extends Behavior {
  constructor(private radPerSec: number) { super() }
  onUpdate(dt: number): void {
    this.node.transform.rotation += this.radPerSec * dt
  }
}

const node = new ShapeNode({ ... })
node.addBehavior(new SpinBehavior(0.5))
```

A behavior reaches its node via `this.node`, which is set between attach and detach.

Look up behaviors by class:

```ts
const spin = node.getBehavior(SpinBehavior)
if (spin) spin.radPerSec *= 2

const allDamping = node.getBehaviors(DampingBehavior)
```

Both use `instanceof`, so subclasses match.

`onFixedStep` runs at the fixed-step rate (120 Hz by default, set via `EngineHostOptions.fixedStepHz`), inside the accumulator loop. Use it for anything that must be independent of render `dt`, such as collision or physics integration. Use `onUpdate` for everything else.

### PointerBehavior

An input behavior almost always binds pointer handlers on attach and unbinds on detach. `PointerBehavior` captures that lifecycle: return the handlers from `handlers()` and the base wires them with `bindPointer` on attach and tears them down (with a synthetic cancel if a drag is live) on detach.

```ts
class DragToMove extends PointerBehavior {
  protected handlers(): PointerHandlers {
    return {
      singlePointer: true, // ignore extra fingers while one drags
      move: (e) => {
        const p = e.localTo(this.node) // world → this node's local space
        this.node.transform.x = p.x
        this.node.transform.y = p.y
      },
    }
  }
}
node.addBehavior(new DragToMove())
```

Override the optional `onPointerDetach()` for cleanup that should run after the handlers are unbound. See [Input](/guides/input) for `bindPointer`, `singlePointer`, and region gestures.

## Async lifecycle scoped to nodes

`destroy()` is idempotent: the first call marks the node destroyed and every later call returns immediately, so there's no need to guard it with `if (!node.isDestroyed) node.destroy()` — just call `destroy()`.

Every `Node2D` has a private `AbortController`; `node.abortSignal` exposes it read-only. `node.destroy()`:

1. Marks the node destroyed.
2. Destroys every child first, bottom-up.
3. Detaches every behavior.
4. Aborts its own controller.
5. Emits `'destroy'` on `node.events`.
6. Removes the node from its parent.

Anything scoped to `node.abortSignal`, including every `node.tween(...)`, `node.wait(...)`, and `node.animate(...)`, rejects with `AbortError` when the node dies. Swallow it with `ignoreAbort` in a `.catch(...)`:

```ts
import { ignoreAbort } from '@src/stargazer'

await node
  .tween({ alpha: 0 }, { duration: 0.5, easing: easings.outCubic })
  .catch(ignoreAbort)
```

More on the abort contract in [Animation](/guides/animation).

## Hit testing

An `InputSystem` walks the scene back-to-front on `pointerdown` and finds the topmost node with `hitEnabled === true` whose `hitTest(worldX, worldY, touchSlopWorld)` returns true. That node captures the pointer at both the node level and the DOM level (`canvas.setPointerCapture`).

Each concrete node type has its own hit test:

- `ShapeNode`, a radius check for circles and a bounding-box check for rects, in local coords.
- `Path2DNode`, driven by `hitMode: 'fill' | 'stroke' | 'circle' | 'none'`. `'fill'` and `'stroke'` transform the world point into local coords and call `isPointInPath` / `isPointInStroke`; `'circle'` is a radius check against `hitRadiusWorld`.
- Base `Node2D`, the bounding box from `node.debugBounds` (or false when it's null).

Override `hitTest` in a subclass if you need something else: world-space in, boolean out.

See [Input](/guides/input) for the rest of the pipeline.

## Render layers

`node.renderLayer` picks one of three passes, drawn in this order every frame:

- `'static'`. Use it for content that changes rarely, such as a background or map.
- `'above-static'`. Drawn between the static and dynamic passes. The place for a static node that's temporarily animating.
- `'dynamic'` (default). Drawn on top.

The three passes exist purely for draw order, not caching, GPU fill rate makes redrawing the static layer every frame trivial. Mutating a node on any layer, including `'static'`, is safe at any time; there's no bake to go stale.

### Z-order

Within a layer, draw order follows scene-tree DFS pre-order: a parent draws first, then its children, then the next sibling. Between layers the order is static, then above-static, then dynamic. A node on `'above-static'` ends up above the static content but below anything on `'dynamic'`.

### Viewport culling

`drawLayer` skips any node whose world-space bounding box (from `debugBounds`, inflated by the stroke half-width) lies fully outside the visible world rect, derived from the canvas corners via `screenToWorld`. Nodes without `debugBounds` always draw. The biggest win is a fresh draw during a zoom-in, where only the few nodes inside the frame get rasterized.

## Stroke widths and camera zoom

Every stroke-capable primitive (`ShapeNode`, `Path2DNode`, `PolylineNode`) treats `lineWidth` as CSS pixels by default. When the camera zooms in, the stroke stays the same visual thickness because its device-pixel width tracks the DPR baseline, not the camera scale.

To make a stroke scale with the world instead, so its thickness is a physical part of the scene, opt into world space per node:

```ts
import { Path2DNode } from '@src/stargazer'

const track = new Path2DNode({
  path,
  stroke: '#ffd34d',
  lineWidth: 8,
  strokeSpace: 'world', // scales with camera zoom
})
```

The default (`strokeSpace: 'screen'`) mirrors how CSS `stroke-width` behaves under an SVG viewport transform. A node that overrides `draw` can reproduce it with `ctx.lineWidth = cssPx * camera.strokeSpaceScale()`. See [Camera](/guides/camera#stroke-space-scale) for the math.

## Scene lifecycle

`host.loadScene(builder)` destroys the current children of `scene.root` and calls `builder(scene, engine)` to populate it. Do one-time scene construction there:

```ts
await host.loadScene((scene, engine) => {
  const map = new Node2D('map')
  map.renderLayer = 'static'
  scene.root.add(map)

  for (const entry of backgroundPaths) {
    const region = new Path2DNode({
      path: entry.path,
      fill: '#354a6e',
      hitMode: 'fill',
    })
    region.renderLayer = 'static'
    map.add(region)
  }
})
```

`host.destroy()` recursively destroys `scene.root`: every node's `abortSignal` fires, every pending tween rejects, every behavior detaches.

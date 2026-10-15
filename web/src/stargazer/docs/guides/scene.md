---
title: Scene graph
group: Getting started
order: 3
---

# Scene graph

Everything a stage draws lives in one tree of nodes. A {@link SceneTree} holds 2D nodes ({@link Node2D}) and 3D nodes ({@link Node3D}) under a single root, `tree.root`. The root is a {@link GroupNode}, a node with no transform of its own.

Each {@link Stage} owns one tree. `engine.tree` is the primary stage's tree, and a stage from `engine.attachStage(...)` has its own as `stage.tree`. See [Stages](/guides/stages) for a second canvas. This guide covers the 2D side. See [3D](/guides/3d) for {@link Node3D}.

## Basic usage

A scene builder passed to `host.loadScene` adds a camera and some content to the root. The host comes from {@link createEngineHost}, see [Setup](/guides/setup).

```ts
import { CameraNode2D, ShapeNode } from '@src/stargazer'

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)

  const ball = new ShapeNode({
    geometry: { kind: 'circle', radius: 60 },
    fill: '#ffd34d',
  })
  ball.transform.x = 960
  ball.transform.y = 540
  scene.root.add(ball)
})
```

The camera frames a 1920 by 1080 world rect, and a yellow circle sits in its center. `loadScene` destroys the previous scene's content before it calls the builder, so the builder adds its own camera. See [Camera](/guides/camera).

### Nodes and the tree

A {@link Node2D} has a transform, a parent, children, and optional behaviors. A plain `Node2D` draws nothing, so it works as a container that moves its children together. These built-in nodes draw:

- {@link ShapeNode}, a circle, ellipse or rect with optional fill, stroke, drop shadow and smooth corners
- {@link Path2DNode}, a `Path2D` with optional fill, stroke and drop shadow
- {@link PolylineNode}, an append-only polyline with optional quadratic smoothing
- {@link TextNode}, one or more lines of text, see [Text](/guides/text)
- {@link ImageNode}, an image drawn as a rectangle
- {@link ParticleEmitterNode} and {@link VectorParticleNode}, see [Particles](/guides/particles)
- {@link LottieNode}, a Lottie animation, see [Lottie](/guides/lottie)

To draw anything else, subclass `Node2D` and override `paint`. See [Painting a node](#painting-a-node).

`parent.add(child)` appends children, and `parent.remove(child)` detaches them. Adding a node that already has a parent moves it. `tree.add(...)` is shorthand for `tree.root.add(...)`.

### Transforms

`node.transform` is a {@link Transform2D}. Set its fields directly:

```ts
node.transform.x = 100
node.transform.y = 200
node.transform.rotation = Math.PI / 4 // radians, clockwise
node.transform.scaleX = 2
node.transform.alpha = 0.5
```

The fields are `x`, `y`, `scaleX`, `scaleY`, `rotation`, `skew`, `skewAxis`, `originX`, `originY` and `alpha`. Positions are in the parent's local space, so a child moves, turns and scales with its parent. `originX` and `originY` are the pivot that scale and rotation turn around.

To animate a transform, use `node.tween(...)` instead of changing fields every frame. See [Animation](/guides/animation).

### Behaviors

A {@link Behavior} attaches logic to a node. Extend it, override the hooks you need, and attach an instance with `addBehavior`:

```ts
import { Behavior } from '@src/stargazer'

class Spin extends Behavior {
  radPerSec: number
  constructor(radPerSec: number) {
    super()
    this.radPerSec = radPerSec
  }
  override onUpdate(dt: number): void {
    this.node.transform.rotation += this.radPerSec * dt
  }
}

node.addBehavior(new Spin(0.5))
```

The node spins half a radian per second. A behavior reaches its node through `this.node`. The hooks are `onAttach`, `onSceneReady`, `onDetach`, `onUpdate(dt)` and `onFixedStep(fixedDt)`.

`getBehavior(Spin)` returns the first attached behavior of that class, or `null`. `getBehaviors(Spin)` returns all of them. Both use `instanceof`, so subclasses match. `removeBehavior(b)` detaches one.

### Destroying nodes

`node.destroy()` destroys the node and its whole subtree, detaches its behaviors, and removes it from its parent. Calling it again does nothing.

Destroying a node aborts `node.abortSignal`. Every `node.tween(...)` and `node.wait(...)` is tied to that signal, so it rejects with an `AbortError` when the node dies. Pass {@link ignoreAbort} to `.catch` to ignore that rejection:

```ts
import { easings, ignoreAbort } from '@src/stargazer'

await node
  .tween({ alpha: 0 }, { duration: 0.5, easing: easings.outCubic })
  .catch(ignoreAbort)
```

### Draw order

2D content draws in tree order: a parent first, then its children in the order they were added, then the parent's next sibling. A later node draws over an earlier one. A backdrop is the first node you add.

To draw a node under nodes added before it, insert it at a position with `parent.addAt(node, index)` or `parent.insertBefore(node, reference)`. Both also move a node that is already a child of that parent. You can change the tree at any time.

### Visibility and alpha

`node.visible = false` hides the node and everything under it, for drawing and for hit testing. A hidden subtree still updates. Destroy a subtree you are finished with instead of hiding it. {@link isEffectivelyVisible} tells you whether a node is visible with its ancestors taken into account.

`transform.alpha` multiplies into everything under the node, so a parent fades its whole subtree. The alpha applies to each drawing separately, so overlapping parts of a translucent group show through each other. Set `compositeGroup = true` on the parent to fade the group as one flat image. See [Groups, blend modes and mattes](#groups-blend-modes-and-mattes).

### Painting a node

A custom node overrides `paint(canvas)` to record what it looks like. The engine keeps the recording, a picture, and replays it every frame under the node's transform and alpha. Moving, scaling, rotating or fading the node does not run `paint` again.

```ts
import { Node2D, definePaintProps, type Canvas } from '@src/stargazer'

class Eye extends Node2D {
  declare openAmount: number
  constructor() {
    super()
    definePaintProps(this, { openAmount: 1 })
  }
  override paint(canvas: Canvas): void {
    canvas.fillCircle(0, 0, 20, '#fff')
    canvas.fillCircle(0, 0, 8 * this.openAmount, '#222')
  }
}

const eye = new Eye()
scene.root.add(eye)
await engine.tween(eye, { openAmount: 0 }, { duration: 0.2 })
```

{@link definePaintProps} declares the fields that `paint` reads. Writing a new value to one, by hand or by a tween, makes the node paint again. Declare the fields with `declare` and no initializer, because a class field with an initializer hides the property. `canvas` is a {@link Canvas} in the node's local space, with the drawing calls described in [Drawing](/guides/drawing).

## Advanced usage

This section covers reuse, the lifecycle in detail, hit testing, repaint rules, groups and mattes, culling, strokes, clips, insets, layers, and scene loading.

### Reusable subtrees

To reuse part of a tree, write a function that builds and returns it. There is no separate prefab type. Each call returns an independent copy, and builders can call other builders.

```ts
function buildArena(): Node2D {
  const arena = new Node2D('arena')
  arena.add(buildBall())
  return arena
}
scene.root.add(buildArena())
scene.root.add(buildArena())
```

Attach behaviors in the builder to make the subtree self-contained. A {@link PhysicsWorldBehavior}, for example, gives a subtree its own physics world, so two arenas simulate independently. See [Physics](/guides/physics).

A node can also keep an HTML element aligned with it. See [HTML overlays](/guides/html-overlays).

### Nodes of other kinds in the tree

The tree mixes three kinds of node: {@link Node2D}, {@link Node3D} and {@link GroupNode}. Each 2D node takes its world transform from the nearest `Node2D` above it, skipping nodes of other kinds. A `Node2D` under a `GroupNode` or a `Node3D` with no `Node2D` above it is placed as if it sat at the root. Use a `GroupNode` to group content for lifecycle and visibility without adding a transform.

### World transforms

`transform.local` and `transform.world` are {@link Affine2D} matrices with six numbers, `a` to `f`. Treat both as read-only. Every field setter marks the node dirty. Once per frame, the stage rebuilds `local` for dirty nodes and sets `world` to the parent's world times `local`.

The composition order is origin, scale, skew, rotate, then translate. `skew` shears along the direction `skewAxis` gives, in radians. The default axis 0 is a horizontal shear.

Code that changes an ancestor and needs a descendant's new position in the same frame calls `node.ensureWorldTransform()`. `node.worldToLocal(x, y)` and `node.localToWorld(x, y)` call it for you.

### Behavior lifecycle

`addBehavior` sets `this.node` and calls `onAttach` at once. `onSceneReady` runs once after that, as soon as the node is in a scene, so it is the place to read `this.node.engine`. `onDetach` runs when the behavior is removed or the node is destroyed.

A behavior targets {@link Node2D} by default. A behavior for 3D nodes extends `Behavior<Node3D>`, and one for either kind extends `Behavior<Node>`.

A node can also override `onUpdate` and `onFixedStep` itself, without a behavior.

### Update order

Each frame, the engine calls `onUpdate(dt)` on every node that has update work of its own or on a behavior. `dt` is the frame time in seconds. The order is tree order. A node's own `onUpdate` runs before its behaviors', and its behaviors run in the order they were attached. Nodes without update work cost nothing.

A node added during the pass first updates on the next frame. A node destroyed during the pass is skipped, and the nodes after it still update.

`onFixedStep(fixedDt)` follows the same rules at a fixed rate, 120 Hz by default. `fixedStepHz` in the engine host options sets the rate. Use it for anything that must not depend on the frame rate, such as physics integration. Pausing the engine with `engine.setPaused(true)` stops both passes.

### `PointerBehavior`

{@link PointerBehavior} is a base class for a behavior that handles pointer input. Return the handlers from `handlers()`. The base class binds them with `bindPointer` on attach and unbinds them on detach.

```ts
import { PointerBehavior, type PointerHandlers } from '@src/stargazer'

class DragToMove extends PointerBehavior {
  protected handlers(): PointerHandlers {
    return {
      singlePointer: true, // ignore extra fingers while one drags
      move: (e) => {
        const parent = this.node.spatialParent
        const p = parent ? e.localTo(parent) : e.pointer.world
        this.node.transform.x = p.x
        this.node.transform.y = p.y
      },
    }
  }
}
node.addBehavior(new DragToMove())
```

The node follows the finger. The position is taken in the space of the nearest `Node2D` above the node, because that is the space `transform.x` and `transform.y` are in. A node with no `Node2D` above it uses the world position. Override the optional `onPointerDetach()` for cleanup that runs after the handlers are unbound. See [Input](/guides/input) for `bindPointer` and the ready-made button and drag behaviors.

### Async work scoped to a node

`node.destroy()` does these steps in order:

1. Marks the node destroyed.
2. Destroys every child.
3. Detaches every behavior.
4. Aborts `node.abortSignal`.
5. Emits `'destroy'` on `node.events`.
6. Removes the node from its parent.

These helpers are all tied to `node.abortSignal`:

- `tween(to, opts)` animates the transform and returns a promise
- `play(to, opts)` is `tween` without the promise, and ignores the abort
- `tweenTo(target, to, opts)` and `playTo(target, to, opts)` do the same for any object
- `wait(seconds)` resolves after a delay in engine time
- `loop(body)` runs an async body again and again while the node lives
- `scope()` returns an {@link AbortScope} that the node's death aborts
- `autoDestroy(promise)` destroys the node when the promise settles

`tween` and `wait` need the node to be in a scene. On a detached node they reject. Pass `node.abortSignal` to your own async work so that a destroyed node does not leave a promise pending. `engine.animate(node, to, opts)` is the engine-level form of `node.tween`. More on aborting in [Animation](/guides/animation).

### Hit testing

On a pointer press, the input system checks the 2D nodes from the topmost drawn down. It skips nodes that are hidden or have `hitEnabled` false. The first node whose `hitTest(worldX, worldY, touchSlopWorld)` returns true captures the pointer.

The built-in nodes test these shapes:

- {@link ShapeNode} tests the circle for a circle and the geometry's box for a rect, in local space.
- {@link Path2DNode} uses `hitMode`. `'fill'` and `'stroke'` test the path exactly, `'circle'` tests a circle of radius `hitRadiusWorld` around the local origin, and `'none'` never hits.
- A plain {@link Node2D} tests `node.bounds`, the bounds of its picture. It returns false when there is no picture.

`boundsOverride` replaces the picture's bounds. A container with no picture of its own sets it to take taps over a region. To test another shape, override `hitTest` in a subclass. It receives a point in world space and returns a boolean. {@link hitTestCircle} is a helper for a circle around the node's origin. See [Input](/guides/input) for the rest of the pipeline.

### When a node repaints

A node runs `paint` again in these cases:

- A paint property declared with `definePaintProps` gets a different value. Hold primitives, or replace objects instead of changing them in place.
- A resource it declared with `canvas.use(resource)` changes its `version`. A {@link VersionedRef} is such a resource, and `ref.touch()` bumps it. A path drawn with `fillPath` or `strokePath` is tracked without `use`.
- The node calls `markNeedsPaint()`, for state it owns and changes by hand.
- It called `canvas.snap(length)` and the scale it is drawn at settles at a new value. `snap` rounds a length to whole device pixels.
- It called `canvas.visibleWorldRect()` and the camera's view changes.
- It called `canvas.screenScale()` and the world size of a CSS pixel changes.

`paint` must depend only on that state. It must not read the clock, the camera, the node's transform or other changing state, and it must not mark any node for repaint, which throws in development. In development, the engine also paints a few unchanged nodes again each frame and warns once per node when the result differs from the kept picture. That is how a dependency that was not declared shows up.

A size in CSS pixels is `size * canvas.screenScale()`. A stroke width can be `{ screen: 2 }`, which is 2 CSS pixels at any zoom and needs no repaint. Inside `paint`, `canvas.setAlpha` is relative to the node's alpha.

Content that moves on a clock belongs in a child node whose transform `onUpdate` changes, because a transform change never repaints. A spinning mark is a small child node with its own picture, not a rotation inside the parent's `paint`.

`pixelSnap = true` rounds the node's origin to a whole device pixel when it draws, without a repaint. To test what a node draws, `paintCalls(node, { deviceScale })` runs its `paint` and returns the recorded calls in the vocabulary of `Canvas`.

### Groups, blend modes and mattes

Three node properties draw a node and its subtree into an offscreen surface and then composite that surface as one image:

- `compositeGroup = true` composites the subtree once with the node's alpha, so a translucent group looks like one flat image.
- `compositeBlend` sets how the node blends with what is under it. Any value other than `'source-over'` makes the node a group. The supported modes are `'source-over'`, `'lighter'`, `'screen'`, `'multiply'`, `'destination-out'`, `'destination-in'` and `'xor'`.
- `matte` names another node whose drawing masks this one, a track matte. `matteMode` is `'alpha'` (the default), `'inverted-alpha'`, `'luma'` or `'inverted-luma'`.

```ts
const card = new Node2D()
card.compositeGroup = true
card.transform.alpha = 0.5 // the card fades as one image

const mask = new ShapeNode({
  geometry: { kind: 'circle', radius: 80 },
  fill: '#fff',
})
parent.add(photo, mask)
photo.matte = mask // photo shows only inside the circle
```

The matte node is not drawn on its own. It can sit anywhere in the tree, usually next to the node it masks so that both share a parent's transform. A node can be the matte of one node only. A hidden matte node is an empty matte, which hides the node, or shows all of it for an inverted mode.

A group costs a surface each frame and a render pass of its own, so turn it on only where it changes the result. A group that contains an `InsetViewNode` falls back to drawing each part separately, without the matte. None of these properties changes a picture, so toggling them never repaints.

### Viewport culling

The compose walk skips a painted node when its bounds lie fully outside the visible world rect. The bounds are the picture's bounds combined with `boundsOverride`, grown by the stroke half-width. A node whose picture has unknown bounds, such as one that draws a `Path2D`, is culled only if it sets `boundsOverride`. A {@link Path2DNode} gets bounds from its `bounds` option. A culled node still checks its dependencies, so it is up to date when it comes back into view.

### Stroke widths and camera zoom

The stroked nodes ({@link ShapeNode}, {@link Path2DNode}, {@link PolylineNode}) treat `lineWidth` as CSS pixels by default (`strokeSpace: 'screen'`). The stroke keeps its thickness on screen when the camera zooms. To make a stroke scale with the world, set `strokeSpace: 'world'`:

```ts
import { Path2DNode } from '@src/stargazer'

const track = new Path2DNode({
  path,
  stroke: '#ffd34d',
  lineWidth: 8,
  strokeSpace: 'world', // scales with camera zoom
})
```

The `shadow` option of {@link ShapeNode} and {@link Path2DNode} follows the same setting. Its `offsetX`, `offsetY`, `blur` and `spread` stay the same on screen by default. A custom node writes a stroke width as `{ screen: px }` in its stroke style for the same effect. See [Drawing](/guides/drawing) and [Camera](/guides/camera).

### Clipping a subtree

`node.clip` limits a node and all its descendants to a region in the node's own space. The region is a rect `{ x, y, width, height }` or a {@link GfxPath}.

```ts
const panel = new Node2D()
panel.clip = { x: 0, y: 0, width: 320, height: 200 }
panel.add(list) // rows that scroll past the edge are cut off
```

The clip follows the node's transform, so a rotated or scaled panel clips correctly. Clips on nested nodes narrow each other, up to 7 deep. Set it to `null` to remove it. The clip uses the stencil buffer, so it costs a few extra draws per clipped subtree, not per node. Setting it does not repaint any node.

### Inset views

An `InsetViewNode` shows a separate 2D world inside a rounded rect, with a view of its own, like picture-in-picture. Build the inner world under `inset.content` in its own units. Set `inset.viewport` to the rect of that world to show. The rect is fitted into the inset at a uniform scale and centered. Setting it every frame pans and zooms like a camera.

```ts
import { InsetViewNode } from '@src/stargazer'

const inset = new InsetViewNode({ width: 392, height: 516, radius: 40 })
inset.content.add(ship)
engine.ticker.onFrame(() => {
  inset.viewport = {
    x: ship.transform.x - 39,
    y: ship.transform.y - 52,
    width: 78,
    height: 104,
  }
})
card.add(inset)
```

The inset follows the ship. Everything under `content` is clipped to the rounded rect. It draws with a view that includes the inset's zoom, so a screen-space stroke keeps its width on screen and `visibleWorldRect` reports the inner world's rect. The inset moves and scales with its parents like any node.

An inset has these limits:

- A node inside that calls `setClip` itself replaces the inset's clip for its own draw.
- An inset inside another inset is clipped to the inner one only.
- Pointer input and HTML overlays do not see the inset's view. They treat inner nodes in the parent's coordinates.

### Layers

A {@link Layer} gives its subtree a placement of its own. The stage camera moves and scales everything in the tree, which is wrong for a heads-up display that should stay put while the camera pans. Put such nodes under a layer whose `space` is not `'world'`, and the camera does not move them.

```ts
import { Layer, TextNode } from '@src/stargazer'

// One unit is one CSS pixel, origin at the top left of the canvas.
const hud = new Layer({ space: 'screen' })
hud.add(new TextNode({ text: 'Score 0', x: 16, y: 16, baseline: 'top' }))
scene.root.add(hud)

// Laid out for a 1920 by 1080 design, fitted into any canvas shape.
const ui = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
})
scene.root.add(ui)
```

The {@link LayerSpace} values are:

- `'world'`, the default, uses the view in effect where the layer sits.
- `'screen'` maps one unit to one CSS pixel, with the origin at the top left of the canvas.
- `{ frame }` fits the rect into the canvas at a uniform scale and centers it, the way a camera fits its viewport. The design keeps its proportions at any canvas shape.

A layer with a space of its own is the root of that space. Its own `transform` places the subtree inside the view, so a screen layer can be offset, scaled or rotated in CSS pixels. Every `transform.world` under it is in layer space, so `localToWorld`, hit testing and layout work as usual. `alpha` and `visible` still cascade from above.

The nearest layer above a node whose space is not `'world'` decides where the node is placed. Pictures under a screen or frame layer do not repaint when the camera zooms, because their view does not change. Pointer input follows the placement, see [Input](/guides/input).

Code that needs the view placing a node, such as a screen position or a pointer conversion, calls {@link viewFor} with the node and the stage. {@link layerOf} returns the layer that places a node, or `null` under the camera.

A layer can also run post-processing effects over its subtree only, and keep its rendered result between frames with `cache: 'raster'`. See [Post-processing](/guides/post-processing).

### Scene lifecycle

`host.loadScene(builder)` destroys the current children of the root and then calls `builder(scene, engine)`. The builder may be async, and `loadScene` returns a promise that resolves when it finishes. Await it.

A node with `persistent = true` survives a scene load and `destroyChildren()`, together with its subtree. A {@link Layer} takes `persistent` as an option. A persistent node keeps drawing and taking input across scene loads, so use it only for content that does not depend on the scene. Destroying it directly still works.

`host.destroy()` destroys the engine and the tree. Every node's `abortSignal` fires, every pending tween rejects, and every behavior detaches.

## See also

- {@link Node2D}: the 2D node, its transform, hooks and pointer handlers
- {@link Behavior}: logic attached to a node
- {@link SceneTree}: the tree a stage owns
- {@link Transform2D}: position, scale, rotation, skew and alpha
- {@link Layer}: a subtree with a placement of its own
- {@link definePaintProps}: fields that make a node repaint
- [Drawing](/guides/drawing): the `Canvas` calls inside `paint`
- [Camera](/guides/camera): the view that places the tree
- [Input](/guides/input): pointer handlers and hit testing
- [Animation](/guides/animation): tweens, waits and aborts
- [Stages](/guides/stages): more than one canvas

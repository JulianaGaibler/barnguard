# Drawing

Every pixel the engine puts on screen goes through `Gfx2D`, an immediate-mode
drawing facade. The built-in nodes call it for you. Override `draw` on a `Node2D`
and you call it yourself, in the node's own local coordinates.

Reach for a custom `draw` when no primitive fits: a board's grid, a gauge, a
composite badge. Reach for `ShapeNode`, `Path2DNode`, `PolylineNode`, or
`TextNode` first, because they already handle bounds, hit testing, and stroke
scaling. See [Scene graph](/guides/scene) for what each one covers.

## Overriding draw

```ts
import { Node2D } from '@src/stargazer'
import type { Gfx2D, CameraView2D } from '@src/stargazer'

class Gauge extends Node2D {
  value = 0.4

  override draw(gfx: Gfx2D, camera: CameraView2D, _dt: number): void {
    gfx.fillRoundRect(0, 0, 200, 24, 12, '#1c2438')
    gfx.fillRoundRect(0, 0, 200 * this.value, 24, 12, '#ffd34d')
  }
}
```

Three things are already true when `draw` runs. The combined device, camera, and
world transform is installed, so you draw in local units and the node's own
`transform` places it. The node's compounded alpha is set. And the node has
passed the visibility and culling checks.

`camera` is the current `CameraView2D`, there for the queries a draw needs:
`strokeSpaceScale()`, `screenPxPerWorldUnit()`, `visibleWorldRect()`.

## Style is per call

There is no sticky state. Every fill takes its color, every stroke takes a full
`GfxStrokeStyle`. That makes batching predictable and keeps a draw method
readable, at the cost of repeating a style object. Hoist styles that never
change to module scope.

```ts
const RULE: GfxStrokeStyle = { color: '#2a3550', width: 1 }

override draw(gfx: Gfx2D, camera: CameraView2D): void {
  const w = 1 * camera.strokeSpaceScale()
  for (let i = 0; i <= 8; i++) {
    gfx.strokeLine(0, i * 40, 320, i * 40, { ...RULE, width: w })
  }
}
```

Stroke widths are resolved by the caller, not the facade. A width in CSS pixels
becomes a width in the current transform space by multiplying
`camera.strokeSpaceScale()`. Skip that and the stroke thickens as the camera
zooms in. Dash lengths need the same treatment.

## What you can draw

Fills: `fillRect`, `fillRoundRect`, `fillCircle`, `fillConvexPoly`,
`fillPath2D`, `fillCircleRadialGradient`, `fillPolyLinearGradient`,
`fillMaskedRadialGradient`.

Strokes: `strokeLine`, `strokeCircle`, `strokeRoundRect`, `strokePolyline`,
`strokeQuadratic`, `strokePath2D`.

Everything else: `drawImage`, `fillText`, `warmText`.

`fillRoundRect` and `strokeRoundRect` take the CSS `border-radius` shorthand, so
`24`, `[0, 32, 0, 0]`, and `[tl, tr, br, bl]` all work, and a radius at or above
half the shorter side gives a capsule. Circles and rounded rects are signed
distance fields anti-aliased in local space, so they stay crisp at any zoom or
rotation with no geometry to re-tessellate.

`fillPath2D` and `strokePath2D` are the escape hatch for SVG geometry, and they
need a registered tessellation. A `Path2D` you built by hand silently draws
nothing and ticks a counter in the debug HUD. See [Assets](/guides/assets).

Text is its own subject. See [Text](/guides/text).

## Transform, alpha, and blend

`save` and `restore` bracket a change to the transform, alpha, blend, or clip.
`translate`, `rotate`, and `scale` post-multiply onto the current transform, the
same as Canvas 2D.

```ts
override draw(gfx: Gfx2D): void {
  for (const card of this.cards) {
    gfx.save()
    gfx.translate(card.x, card.y)
    gfx.rotate(card.tilt)
    gfx.setAlpha(card.fade)
    this.drawFace(gfx)
    gfx.restore()
  }
}
```

`setAlpha` is absolute, like `globalAlpha`. It replaces the value rather than
multiplying into it, so a nested draw that wants to dim relative to its parent
has to read and multiply itself.

`setBlend` takes `'source-over'` (the default) or `'lighter'` (additive). Other
composite modes are not implemented.

## Clipping

Two clips, and the analytic one is almost always the right choice.

`setClip({ kind: 'circle', cx, cy, r })` or `setClip({ kind: 'roundRect', x, y,
w, h, radius })` crops every following draw to that shape with a crisp
anti-aliased edge, evaluated in the fragment shader. No texture, no CPU raster,
no extra draw call. Coordinates are local and snapshotted when set, so the clip
composes with `save` and `translate`. Clear it with `null`, or let `restore` do
it.

```ts
gfx.save()
gfx.setClip({ kind: 'roundRect', x: 0, y: 0, w: 240, h: 160, radius: 16 })
gfx.drawImage(portrait, 0, 0, 240, 160)
gfx.restore()
```

A circle clip is rotation-safe. A rounded rect assumes an axis-aligned
transform, and warns once in dev if it gets rotation or skew.

`setClipMask(mask)` handles an arbitrary shape by sampling a `BitmapMask`'s
alpha. It only masks fills, not strokes or text, and it uploads a texture. Use
it when the shape genuinely cannot be a circle or a rounded rect.

## Pixel snapping

`gfx.snapSize(v)` rounds a local-space length to a whole number of device
pixels. Use it on sizes, not positions. A grid of equal cells loses the
cell-to-cell width variance that reads as aliasing, and the block keeps one
shared subpixel offset so it still slides smoothly. Snapping positions too is
crisper at rest but crawls under motion, because each edge crosses its threshold
on a different frame.

```ts
const cell = gfx.snapSize(box.width / 16)
for (const run of runs) {
  gfx.fillRect(
    ox + run.x * cell,
    oy + run.row * cell,
    run.len * cell,
    cell,
    run.color,
  )
}
```

`gfx.deviceScale()` is the raw number behind it, device pixels per local unit.

## Bounds and culling

Set `node.debugBounds` to the node's local-space AABB. It buys three things: the
renderer can cull the node when its world box leaves the visible rect, the base
`hitTest` works, and the debug outline overlay can draw it.

A node with no bounds draws every frame no matter where the camera is. That is
the default, and it is the single most common reason a scene stays expensive
after zooming in.

```ts
class Gauge extends Node2D {
  constructor() {
    super()
    this.debugBounds = { x: 0, y: 0, width: 200, height: 24 }
  }
}
```

## Keeping the batch intact

A frame's draws append into per-program ring buffers, and the whole list replays
in painter order at frame end. What breaks a batch is a change of program,
texture, blend mode, or clip. What does not break a batch is alpha, color, or
transform, because those ride in the per-instance data.

That shapes a few habits.

**Fade with alpha, not color.** `setAlpha` folds into the instance data.
Rewriting a color string allocates and, for text, re-rasterizes the label.

**Do not build color strings per object per frame.** `mixColor` and `withAlpha`
return strings, so they allocate. They are right for a value you compute once at
module load and wrong inside a loop. To cross-fade many things, draw the old
color and then the new one under `setAlpha`. Same result, no allocation, and
alpha does not flush.

**Do not draw a translucent shape in two passes.** Each pass blends separately,
so wherever they overlap (the joint of a two-stroke chevron, the crossing of a
plus built from two bars) the overlap blends twice and reads as a dark patch.
Precompute the blend instead: one `mixColor(background, ink, amount)` at module
load gives an opaque color that looks the same with nothing to double-blend. For
the same reason, animate such a shape in by scaling it rather than fading it.

A translucent multi-segment stroke is the one case the engine deduplicates for
you, using the stencil buffer, so a dashed translucent polyline does not bead at
its joins.

**Group by texture, not by object.** Interleaving text and images from different
sources flushes on every switch. Page-backed labels and atlas sprites share
fixed texture units, so ordinary text and particle sprites interleave for free.

## Reading the cost

`?debug=hud` opens the HUD. Its Rendering panel reports draw calls, program
switches, texture binds, blend switches, instance counts per family, ring-buffer
overflow warnings, and the label cache. Its Textures inspector shows the atlas
and the label page.

`?debug=perf` additionally wraps each node's update and draw in `performance`
marks, so the browser profiler shows a per-node flame chart.
`engine.lastFrameWorkSec` is CPU work inside the frame, not the vsync interval.

Two readings worth acting on. `overflowWarns` above zero means a ring buffer
filled mid-frame and forced an extra submit, so either the scene draws far more
than expected or a loop is unbounded. A label page wipe means every label in the
scene re-rasterized in one frame, which is the most expensive thing the text
cache can do.

## Where to go next

- [Scene graph](/guides/scene), the nodes that call `Gfx2D` for you
- [Text](/guides/text), measurement, wrapping, and the label cache
- [Assets](/guides/assets), SVG paths and tessellation, bitmap masks
- [Camera](/guides/camera), `strokeSpaceScale` and the coordinate spaces

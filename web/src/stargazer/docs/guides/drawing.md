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

Combined (fill and stroke in one call, so a translucent border composites
against the fill instead of double-blending over it): `fillAndStrokeRoundRect`,
`fillAndStrokeCircle`.

Shadows: `shadowRoundRect`, `shadowCircle` (analytic, no render target). See
[Drop shadows](#drop-shadows).

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

## Gradients

`fillRect`, `fillRoundRect`, `fillCircle`, `fillConvexPoly`, `fillPath2D`, and a
stroke's `color`, all accept a CSS color string or a linear gradient:

```ts
import type { GfxLinearGradient } from '@src/stargazer'

const brand: GfxLinearGradient = {
  kind: 'linear',
  x0: 0,
  y0: 0,
  x1: 0,
  y1: 140,
  stops: [
    { offset: 0, color: '#1d1d2b' },
    { offset: 1, color: '#3a2d5c' },
  ],
}
gfx.fillRoundRect(0, 0, 240, 140, 16, brand)
gfx.strokeRoundRect(0, 0, 240, 140, 16, { color: brand, width: 2 })
```

The axis runs from `(x0, y0)` to `(x1, y1)` in the current transform's local
space, the same convention `rotate`/`scale` already follow. A point on the line
reads `stops[0]`, a point past the far end reads the last stop, matching CSS
`linear-gradient`'s clamped ends.

Every gradient in a frame shares one small atlas texture, so drawing ten
differently-colored gradients costs ten draw calls for the ten shapes, not ten
extra texture binds around them. Reusing the same `stops` array across frames
(a module-level constant, not a literal rebuilt every call) skips re-uploading
it; a fresh array with the same content still dedupes, just with one extra
string join.

A gradient fill on a `fillPath2D` call always takes the slower per-vertex-CPU-
transform path, never the retained upload a solid color on a large static path
gets. Reach for a gradient on a large path only if the retained path wasn't
carrying its weight anyway.

Only `kind: 'linear'` exists today. A gradient stroke on `strokeCircle` or
`strokeRoundRect` (as opposed to a path's border, which does support it; see
below) falls back to the gradient's first stop as a flat color.

## Borders: alignment and exact joins

A stroke is centered by default, the same half-in-half-out band Canvas draws,
and it is quick: no extra geometry, one instance per segment. Set `align` to
move it:

```ts
gfx.strokeRoundRect(0, 0, 240, 140, 16, {
  color: '#1d1d2b',
  width: 3,
  align: 'outside', // 'center' (default) | 'inside' | 'outside'
})
```

On `strokeRoundRect`/`strokeCircle` this is still the analytic SDF, just offset,
so it costs nothing extra. On `strokeLine`, `strokeQuadratic`, `strokePolyline`,
and `strokePath2D`, a non-center `align`, an explicit `exactJoins: true`, or a
gradient `color` all route the stroke through a different renderer: it
tessellates the border into a filled outline with exact miter, round, or bevel
joins and caps, instead of the default per-segment renderer's round caps and
join-free corners (adjacent segment quads just overlap enough to cover a gentle
bend).

```ts
gfx.strokePolyline(points, count, {
  color: '#1d1d2b',
  width: 3,
  join: 'miter',
  miterLimit: 4, // SVG's stroke-miterlimit default, not Canvas's 10
  exactJoins: true,
})
```

`align !== 'center'` needs a closed contour with a well-defined winding: an open
polyline has no inside, and a self-crossing (bowtie) shape has no winding to
read. Either falls back to `'center'` with a one-time console warning rather
than drawing nothing.

The tessellation for a `strokePath2D` call is cached per path, keyed by style and
a half-octave device-scale bucket, so a zoom sweep retessellates only a handful
of times, not every frame. `strokePolyline` cannot be cached: its `pts` buffer
has no stable identity and the caller mutates it every frame anyway. Register a
`Path2D` instead if you need a cached aligned border.

A dashed outline border splits into independent dash runs, each with its own
caps, which is also cached. An **animated** dash phase re-tessellates every
frame doing that, so it stays on the default per-segment renderer, where the
phase is a shader uniform instead of geometry.

A short segment or an acute inner corner can still make the tessellated
boundary overlap itself, the same way an offset curve always can. The result is
a slightly darker patch under a translucent border at that one corner, not a
crash or a hole. Rounding a sharp join, or widening the segment, both avoid it.

## Drop shadows

A rect, rounded rect, or circle (via `shadowRoundRect`/`shadowCircle`, or
`ShapeNode`'s `shadow` option) gets an analytic shadow: no render target, no
cache, no bake latency, same cost every frame.

```ts
gfx.shadowRoundRect(0, 0, 240, 140, 16, {
  color: 'rgba(20, 16, 40, 0.35)',
  offsetY: 8,
  blur: 32,
})
```

`offsetX`/`offsetY`/`blur`/`spread` follow `strokeSpace`, the same convention as
`lineWidth`: resolve them against `camera.strokeSpaceScale()` yourself, same as
a stroke width. `blur` is CSS's blur radius; the shadow's Gaussian sigma is half
of it. `inset: true` draws it inside the shape instead of behind it, matching
CSS `box-shadow`'s `inset`.

Draw order matches CSS: outset shadows, then the fill, then inset shadows, then
the border. An outset shadow is knocked out from under the shape (CSS: "not
painted inside the border-box"), so a translucent fill does not show the shadow
through itself.

`Path2DNode`'s `shadow` option (an arbitrary path's drop shadow, via
`shadowPath2D`) works the same way, but a path has no closed-form signed
distance the way a rect or circle does, so it's not analytic: the path's own
triangles rasterize once into a small cached mask, which two blur passes turn
into a coverage texture reused every frame after. `inset` works too, reading
the same mask from inside `fillPath2D`'s own geometry, no extra pass.

The bake can't run while the frame's main pass is open (a hard rule on WebGPU,
which can't nest render passes), so it runs in a window before the _next_
frame's `beginFrame`. The practical effect: a shadow's first frame, and any
frame the bake budget is exhausted, draws the hard fallback above (translated,
unblurred) instead of the real mask. An inset shadow has no such fallback and
is skipped on those frames, since there's nothing to approximate it with.
Offset is free to animate without rebaking; blur, spread, and a camera zoom
that crosses a cache bucket are not. See
[path shadows](../path-shadows.md) for the cache, its budget knobs, and what
counts as a cache key.

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
its joins. An outline-tessellated border (see [Borders](#borders-alignment-and-
exact-joins)) is a single fill, so it never needs deduplicating in the ordinary
case; the one exception is the short-segment/acute-corner overlap noted there,
which the stencil path does not have either way.

That path needs stencil bits, which a stage's target carries alongside the depth
a 3D pass uses, so a scene can hold 3D content and translucent multi-segment
strokes at the same time. A stage built without stencil, and any surface that
never asked for it, falls back to plain overlapping draws, where a dashed
translucent polyline beads at its joins. How the combined attachment works is
written up in [combined depth and stencil](../combined-depth-stencil.md).

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

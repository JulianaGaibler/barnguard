# Path shadows

`Path2DNode`'s drop shadow (`GpuGfx.shadowPath2D`, backed by
`PathShadowCache`) has no closed-form signed distance to evaluate the way
`ShapeNode`'s rect/circle shadow does, so it works from a cached, blurred
coverage mask instead: a small render target holding the path's own
silhouette, blurred once and reused every frame after. This describes the
bake, its cache key, and the budgets that bound it.

## Why the bake can't run at draw time

`GpuGfx.shadowPath2D` runs during the normal 2D draw walk, between
`beginFrame` and `endFrame`, while the main render pass is open. The bake is
three render passes of its own (a raster, then two separable blur-and-
downsample passes) into three different targets, which cannot nest inside
the main pass: WebGPU has exactly one open render pass per command encoder,
and opening a second would either throw or silently abandon the first,
leaving it never `end()`ed.

So the bake can't be inline. `shadowPath2D` only ever _peeks_ the cache
(`PathShadowCache.peek`, read-only, no GPU work) and queues a request on a
miss. `GpuGfx.processPendingShadowBakes` drains that queue, and both
`Stage.render` and `Viewport2DNode.renderOffscreen` call it in the window
before their own `beginFrame`, where the pre-existing 3D shadow-map and
ambient-occlusion pre-passes already run. Unlike those two, it runs
unconditionally: a pure-2D stage enters neither of their `has3D` guards, and
a brand shadow has to bake regardless.

The practical consequence is one frame of latency. A shadow's first request,
and any request a starved bake budget defers, resolves against whatever was
queued last frame, not this one. For that frame `shadowPath2D` falls back to a
nearby cached mask of the same path, or failing that to the hard (unblurred)
silhouette, as described under
[substitutes](#substitutes-and-converging-back).

## Resolving a mask's size

Blur radius, spread, and the path's own bounds resolve to a mask size and a
per-axis device-px-per-texel scale (`resolveMaskSize` in
`render/gfx/PathShadowCache.ts`):

```
sigmaDevice = blur * 0.5 * bucketScale
k0          = max(1, sigmaDevice / shadowSigmaBudget)
extentDev   = shadowExtentSigmas * sigmaDevice + max(0, spread * bucketScale)
rawDev      = pathBounds * bucketScale + 2 * extentDev      // per axis
maskSize    = min(ceilToMultiple(rawDev / k0, 32), 1024)    // per axis
k           = rawDev / maskSize                              // per axis, final
```

`k0` is resolution, not sigma: raising the blur radius does not grow the
mask's own texel count, it drops the resolution so the blur's sigma in
texels stays near `shadowSigmaBudget` (the quality knob, snapped to 4 / 8 /
12). Mask bytes and bake cost both still fall out of this, since a bigger
`rawDev` at a capped texel count is cheaper, not more expensive, which is
the point: the budget bounds work, not visual size.

`k` is recomputed **after** quantization, separately per axis. The quantize
step (`ceilToMultiple`, 32px bins) and the 1024px cap both change the
effective scale from what `k0` alone would give, and a wide, short shape
quantizes very differently on each axis. Deriving `k` once and sharing it
between axes would blur one axis more than the other under a perfectly
uniform transform.

## The raster, and the two blur passes

The path's own triangles rasterize at 2x the mask's resolution into a
single-channel (`r8`) target, solid white, `blend: 'none'`, so a
self-intersecting path's overlapping triangles overwrite instead of
accumulating into a brighter patch (`shadowMask.wgsl`).

Two passes of `shadowBlur.wgsl` then fold a separable Gaussian blur together
with a 2x downsample on each one's own axis: pass one reads the 2x raster
and halves width, pass two reads pass one's output and halves height,
landing on the final mask with no separate resolve step. Each pass derives
its kernel from its _own_ source resolution: both read an input that is 2x
the final size on the axis they're blurring, so both use `2 * finalSigma`,
not `finalSigma`, for their own tap weights. The final mask is two-channel
(`rg8`): R is the blurred coverage, G is the unblurred silhouette, carried
through each pass with one extra bilinear tap (sampled exactly at the
midpoint between the two texels it merges, which is what a box downsample
is).

Pixel formats narrower than `rgba8` (`r8`, `rg8`) are `TargetPixelFormat`,
not `ColorFormat`: a mask has no color space to speak of, and folding this
into `ColorFormat` would make every existing `srgb ? a : b` branch silently
treat the new member as `rgba8`.

## The cache key, and what stays free to animate

A mask is keyed on the path's identity, its registration epoch (so a
re-parsed SVG at a new tolerance can't serve a mask built from stale
geometry), blur, spread, the two quality knobs that fed the resolution
formula, and a half-octave bucket of the current device scale. Offset is
**not** in the key: the bake doesn't need to know it, since the composite
step places the (fixed) mask at the shape's position plus the live offset.
That's what makes an animated offset free — nothing rebakes — while an
animated blur, spread, or a zoom that crosses a bucket boundary does.

### Substitutes, and converging back

A miss on the exact key resolves to a substitute rather than to nothing: the
same path's closest cached mask, ranked by blur first and scale bucket second.

That order matters. A mask at the requested blur but the wrong bucket is the
right shadow at the wrong resolution, which resampling handles, so the bucket
is unbounded and a camera crossing a wide zoom range always has something to
stand on. Blur is bounded by `MASK_SUBSTITUTE_BLUR_OCTAVES` (half an octave,
the scale bucket's own width), because past that the shadow reads at visibly
the wrong size and skipping it is the better failure.

A substitute is reported through `PathShadowMask.exact === false`, and
`GpuGfx.shadowPath2D` queues the exact bake whenever it sees that, so a
stand-in is always replaced by the real mask within a frame or two. Without
that queue a stand-in would be permanent, since a hit of any kind stops the
caller asking for a bake.

This is what keeps an inset shadow painted. It has no hard fallback, so without
a substitute it draws nothing at all.

Standing in does **not** count as use for
[eviction](#budgets): during churn every mask stands in on the frame after its
own bake, so counting it would put the whole backlog behind the long window and
fill the byte budget again. `lastUsedFrame` still orders eviction, so the
stand-in a shadow is currently drawn from is the last of the short-window
entries to go.

### The substitute has a cliff

Half an octave is a bound, not a guarantee. If the radius moves further than
that between one bake of a given shape and the next, there is nothing close
enough to stand in and the shadow drops out until its own bake lands.

The margin is a race between the radius and the bake queue. A shape's mask
refreshes every `shapes * workPerMask / shadowBakeWorkPerFrame` frames, so the
radius must not travel half an octave in that span. Measured on a 100 unit
square with a 36 px screen-space blur, `rg8` masks around 32 KB:

| zoom                 | shapes | glow-draws unpainted |
| -------------------- | ------ | -------------------- |
| 3x over 10 frames    | 1      | 0%                   |
| 3x over 10 frames    | 4      | 40%                  |
| 3x over 10 frames    | 32     | 66%                  |
| 1.59x over 36 frames | 32     | 22%                  |

One shape outruns nothing. Thirty-two shapes share the per-frame budget about
eleven ways, and a fast zoom then moves the radius several octaves between
refreshes. A world-space radius does not race at all, which is the reason to
prefer it over tuning the budget.

### A zooming camera wants a world-space radius

Blur and spread enter the key in **local units**, which is what `Path2DNode`
passes after resolving `strokeSpace`. A `'world'` radius holds that value
fixed under a camera zoom, so only the scale bucket moves and one mask per
shape covers the whole tween.

A `'screen'` radius is the CSS value over the camera scale, so it takes a new
value on every frame of a zoom: the exact key misses every frame, every frame
queues a bake, and each resulting mask is dead the frame after. The cache
stays legible through this (the nearby-blur substitute paints, and
`MASK_EVICT_FRAMES_UNUSED` keeps the backlog from filling the byte budget),
and it warns once after `BLUR_CHURN_WARN_FRAMES` consecutive frames of
substituting a _different_ blur. A substitution that only crosses buckets does
not warn, or a world-space shadow under a wide zoom would be told to become
world-space. It is still a bake per frame per shape. Use `'world'` for a
shadow on a node the camera zooms, and `'screen'` for one it does not.

## Budgets

Two independent budgets gate a bake, checked in `PathShadowCache.#tryBake`:

- **Byte budget** (`quality.vector.shadowMaskBudgetBytes`). Live mask bytes
  are evicted LRU, oldest-touched first, but never an entry baked within the
  last 240 frames (`MASK_EVICT_FRAMES`): without that hysteresis, two
  same-path, different-style shadows competing for a budget that fits only
  one produce a bake-evict-bake-evict cycle every single frame.
- **Tap-work budget** (`quality.vector.shadowBakeWorkPerFrame`), charged as
  `texels * (4 + 2 * tapsPerTexel)`, not texel count alone: the per-texel
  cost scales with the sigma budget too, so texels alone does not bound
  time. At least one bake per frame is always allowed, even one whose own
  cost exceeds the whole budget, so a single large shape can't starve
  itself forever against its own estimate.

Both budgets are checked before any GPU work for that request, so a
rejected bake costs nothing beyond the arithmetic above.

## Render targets

`RenderTargetPool` (`render/gfx/RenderTargetPool.ts`) gives the bake two
lifetimes from one pool: `acquireTransient` for the raster and the
intermediate blur target (reused by key, freed once nothing asks for that
key in a frame), `acquireRetained` for the final mask (refcounted, lives
until explicitly released). The same class backs `PostProcessPipeline`'s
ping-pong buffers, which only ever need the transient half.

## Context loss

`PathShadowCache` is reconstructed, not rebuilt in place, inside
`GpuGfx`'s `#initGpuResources`, the same point `TextureManager` is rebuilt
and every draw program's `init` reruns. Every mask, baked or queued, is
gone: a context loss drops the whole cache, and the next request for a
shadow re-bakes it from scratch against the restored device.

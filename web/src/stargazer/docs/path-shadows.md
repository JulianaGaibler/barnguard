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
queued last frame, not this one: `shadowPath2D` draws the hard (unblurred)
fallback for that frame instead.

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

A miss on the exact key but a hit on an adjacent bucket resolves to that
stale entry (while a fresh bake for the new bucket is queued), rather than
falling back to hard: close enough to use mid-zoom, and never a different
blur, spread, or style, only ever the scale bucket.

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

---
title: Path shadows
group: Internals
order: 24
---

# Path shadows

`Path2DNode`'s drop shadow is drawn by `GpuGfx.shadowPath2D` and cached by `PathShadowCache`. A `ShapeNode` shadow evaluates the closed-form signed distance of a rectangle or circle. A path has no such distance, so its shadow works from a cached coverage mask: a small render target that holds the path's own silhouette, blurred once and reused every frame after.

## Why the bake can't run at draw time

`GpuGfx.shadowPath2D` runs during the normal 2D draw walk, between `beginFrame` and `endFrame`, while the main render pass is open. The bake is three render passes of its own into three targets: a raster, then two separable blur-and-downsample passes. They cannot nest inside the main pass. WebGPU has one open render pass per command encoder, and opening a second would throw, or abandon the first without ever calling `end()` on it.

So `shadowPath2D` only peeks at the cache (`PathShadowCache.peek`, read-only, no GPU work) and queues a request on a miss. `GpuGfx.processPendingShadowBakes` drains that queue. `Stage.render` calls it in the window before its own `beginFrame`, where the 3D shadow-map and ambient-occlusion pre-passes also run. Unlike those two, it runs on every frame that renders. A pure-2D stage enters neither of their `has3D` guards, and its path shadows still have to bake.

The result is one frame of latency. A shadow's first request, and any request a starved bake budget defers, is served from what was baked before this frame. For that frame `shadowPath2D` falls back to a nearby cached mask of the same path. Without one, an outset shadow draws the hard (unblurred) silhouette, and an inset shadow is skipped. See [substitutes](#substitutes-and-converging-back).

A blur of at most `HARD_SHADOW_BLUR_PX` (1 device pixel) skips the mask entirely. An outset shadow then draws the hard silhouette, and an inset shadow draws nothing. While `quality.vector.pathShadowsEnabled` is off the cache returns no mask, with the same result.

## Resolving a mask's size

Blur radius, spread and the path's own bounds resolve to a mask size and a device-pixels-per-texel scale for each axis (`resolveMaskSize` in `render/gfx/PathShadowCache.ts`):

```
sigmaDevice = blur * 0.5 * bucketScale
k0          = max(1, sigmaDevice / shadowSigmaBudget)
extentDev   = shadowExtentSigmas * sigmaDevice + max(0, spread * bucketScale)
rawDev      = max(1, pathBounds * bucketScale + 2 * extentDev)   // per axis
maskSize    = min(ceilToMultiple(rawDev / k0, 32), 1024)          // per axis
k           = rawDev / maskSize                                   // per axis, final
```

`k0` sets resolution, not sigma. A larger blur radius does not add texels to the mask. It lowers the resolution, so the blur's sigma in texels stays near `shadowSigmaBudget`. That is the quality knob, snapped to 4, 8 or 12, with a default of 8. Mask bytes and bake cost follow from this. A larger `rawDev` at a capped texel count costs less, not more, so the budget bounds work, not visual size.

`k` is computed after quantization, separately for each axis. The 32 pixel bins of `ceilToMultiple` and the 1024 pixel cap both change the scale from what `k0` alone gives. A wide, short shape quantizes very differently on each axis. One `k` shared between axes would blur one axis more than the other under a uniform transform.

## The raster, and the two blur passes

The path's own triangles rasterize at twice the mask's resolution into a single-channel (`r8`) target, solid white, with `blend: 'none'` (`shadowMask.wgsl`). The overlapping triangles of a self-intersecting path overwrite each other and do not add up to a brighter patch.

Two passes of `shadowBlur.wgsl` then combine a separable Gaussian blur with a 2x downsample, each on its own axis. Pass one reads the 2x raster and halves the width. Pass two reads pass one's output and halves the height, which lands on the final mask with no separate resolve step.

Each pass derives its kernel from its own source resolution. Both read an input that is twice the final size on the axis they blur, so both use `2 * finalSigma` for their tap weights, not `finalSigma`.

The final mask has two channels (`rg8`). R is the blurred coverage. G is the unblurred silhouette, carried through each pass with one extra bilinear tap, sampled at the midpoint between the two texels it merges, which is a box downsample.

Pixel formats narrower than `rgba8` (`r8`, `rg8`) are `TargetPixelFormat`, not `ColorFormat`. A mask has no color space. Adding them to `ColorFormat` would make every existing `srgb ? a : b` branch treat the new member as `rgba8` without any error.

## The cache key, and what stays free to animate

A mask is keyed on these values:

- the path's identity
- its registration epoch, so an SVG parsed again at a new tolerance can't be served a mask built from old geometry
- blur and spread
- the two quality knobs that feed the size formula, `shadowSigmaBudget` and `shadowExtentSigmas`
- a half-octave bucket of the current device scale

Offset is not in the key. The bake doesn't need it, because the composite step places the fixed mask at the shape's position plus the current offset. An animated offset therefore never bakes again. An animated blur or spread does, and so does a zoom that crosses a bucket boundary.

### Substitutes, and converging back

A miss on the exact key resolves to a substitute, not to nothing: the same path's closest cached mask, ranked by blur first and scale bucket second.

The order matters. A mask at the requested blur but the wrong bucket is the right shadow at the wrong resolution, which resampling handles. So the bucket distance has no limit, and a camera crossing a wide zoom range always has a mask to draw from. Blur distance is limited to `MASK_SUBSTITUTE_BLUR_OCTAVES` (half an octave, the width of one scale bucket). Past that the shadow reads at a visibly wrong size, and skipping it is the better failure.

`PathShadowMask.exact === false` reports a substitute. `GpuGfx.shadowPath2D` queues the exact bake whenever it sees one, so the real mask replaces a stand-in within a frame or two. Without that queue a stand-in would stay forever, because any hit stops the caller from asking for a bake.

This is what keeps an inset shadow painted. It has no hard fallback, so without a substitute it draws nothing.

Standing in does not count as use for [eviction](#budgets). During churn every mask stands in on the frame after its own bake. Counting that would put the whole backlog behind the long eviction window and fill the byte budget again. `lastUsedFrame` still orders eviction, so the stand-in a shadow currently draws from is the last of the short-window entries to go.

### The substitute has a cliff

Half an octave is a limit, not a guarantee. If the radius moves further than that between one bake of a shape and the next, nothing is close enough to stand in. The shadow drops out until its own bake lands.

The margin is a race between the radius and the bake queue. A shape's mask refreshes every `shapes * workPerMask / shadowBakeWorkPerFrame` frames, so the radius must not travel half an octave in that span. These are measurements on a 100 unit square with a 36 px screen-space blur and `rg8` masks of about 32 KB:

| zoom                 | shapes | shadow draws unpainted |
| -------------------- | ------ | ---------------------- |
| 3x over 10 frames    | 1      | 0%                     |
| 3x over 10 frames    | 4      | 40%                    |
| 3x over 10 frames    | 32     | 66%                    |
| 1.59x over 36 frames | 32     | 22%                    |

One shape keeps up. Thirty-two shapes share the per-frame budget about eleven ways, and a fast zoom then moves the radius several octaves between refreshes. A world-space radius does not race at all, which is the reason to prefer it over tuning the budget.

### A zooming camera wants a world-space radius

Blur and spread enter the key in local units, which is what `Path2DNode` passes after it resolves `strokeSpace`. A `'world'` radius keeps that value fixed under a camera zoom. Only the scale bucket moves, and one mask per bucket covers the whole tween.

A `'screen'` radius is the CSS value divided by the camera scale, so it takes a new value on every frame of a zoom. The exact key misses every frame, every frame queues a bake, and each new mask is dead the frame after. The cache stays usable through this. The nearby-blur substitute paints, and `MASK_EVICT_FRAMES_UNUSED` keeps the backlog from filling the byte budget.

The cache warns once after `BLUR_CHURN_WARN_FRAMES` (20) consecutive frames of substituting a different blur. A substitution that only crosses buckets does not warn, or a world-space shadow under a wide zoom would be told to become world-space. A screen-space radius under a zoom is still one bake per frame per shape. Use `'world'` for a shadow on a node the camera zooms, and `'screen'` for one it does not.

### Warming a scale the camera has not reached

`Stage.warmPathShadows(factors)` bakes the masks another device scale would ask for, before the camera gets there. Each factor is a multiple of the scale every shadow in the frame is drawn at now. One number covers the whole scene whatever each node's own transform: `[2]` for a camera about to zoom to twice its current scale. Only the scale bucket of the product is keyed, so a factor inside the current bucket warms nothing.

Collection runs once, on the next frame that draws. The requests then bake behind that frame's own, as the budget allows. `Stage.pendingPathShadowWarmups` reports how many are left, for a caller that wants to show a loading state until the set is cached.

Warming is best effort in two ways. No draw has asked for a warmed mask, so it is the first entry evicted when live masks need the byte budget. A shadow small enough to draw as a hard silhouette at the current scale asks the cache for nothing, and so warms nothing.

Without warming, a zooming camera arrives with one new mask per shadow to bake, and the bakes land a few per frame. Each shadow sharpens again as its own mask arrives. Meanwhile a [substitute](#substitutes-and-converging-back) paints the right shadow at the previous bucket's resolution.

## Budgets

Two independent budgets gate a bake. `PathShadowCache.#tryBake` checks both before any GPU work for the request, so a rejected bake costs only the arithmetic.

The byte budget is `quality.vector.shadowMaskBudgetBytes`, 48 MB by default. When a new mask doesn't fit, live masks are evicted least recently used first. An entry is protected for a window after its bake. That window is 240 frames (`MASK_EVICT_FRAMES`) for a mask a draw has asked for by its own key, and 2 frames (`MASK_EVICT_FRAMES_UNUSED`) for one no draw has. Without the long window, two shadows of the same path with different styles, competing for a budget that fits only one, would bake and evict each other every frame.

The tap-work budget is `quality.vector.shadowBakeWorkPerFrame`, 4,000,000 by default. A bake is charged `texels * (4 + 2 * tapsPerTexel)`, not its texel count alone, because the cost per texel grows with the sigma budget too. At least one bake per frame is always allowed, even one whose own cost exceeds the whole budget. Otherwise a single large shape could wait forever behind its own estimate.

A third limit bounds the count, not the work. Every bake in a frame takes one slice of the raster uniform ring and two of the blur ring, up to `BAKES_PER_FRAME` (128) bakes. The slices are needed because `GfxDevice.updateUniformBuffer` is not ordered against draws already recorded.

A backend that holds the frame's passes on one command encoder runs every write before the submit. Bakes that shared uniform bytes would all read the last transform and kernel written. One mask would come out right, and the others would rasterize the wrong shape. An inset shadow would then paint as a solid fill (empty mask) or not at all (full mask).

Past that many bakes in one frame the rest wait for the next frame. A bake that cannot reserve its slices caches nothing, so no blank mask is ever cached.

## Render targets

`RenderTargetPool` (`render/gfx/RenderTargetPool.ts`) gives the bake two lifetimes from one pool. `acquireTransient` serves the raster and the intermediate blur target. Those are reused by key and freed once nothing asks for that key in a frame. `acquireRetained` serves the final mask, which is reference counted and lives until it is released. The same class backs the post-processing pipeline's ping-pong buffers, which use only transient targets.

## Context loss

`GpuGfx`'s `#initGpuResources` constructs a new `PathShadowCache`, at the same point where it rebuilds `TextureManager` and reruns every draw program's `init`. Every mask, baked or queued, is gone after a context loss. The next request for a shadow bakes it again from scratch against the restored device.

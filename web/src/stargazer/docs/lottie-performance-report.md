# Lottie rendering performance report

This report is written for a reader who knows nothing about the codebase. It
describes the engine, how Lottie animations are drawn through it, what we
measured, and where we are stuck. Section 9 lists the questions we would like
help with.

## 1. Summary

- **Engine:** Stargazer, a TypeScript 2D/3D engine that draws through WebGL2 or
  WebGPU. It is built to run at 60 fps on 4K screens.
- **Feature:** a `LottieNode` plays a Lottie animation as an ordinary scene node.
  Every shape is drawn as GPU geometry by the engine's own 2D drawing API.
- **Problem:** 50 copies of a small, simple animation run at about 12 fps in
  Firefox on macOS. One copy runs at 60 fps.
- **What the measurements say:**
  - The slowdown follows the number of draw calls per frame. It does not follow
    pixel count (MSAA off made no difference) or geometry volume (1500 trivial
    rectangles are as slow as 50 animations).
  - JavaScript is about 22 ms per frame for the 50-animation scene, which is over
    our 6 ms budget. It is not what limits the frame rate. The main thread spends
    about two thirds of its time waiting for the GPU process.
  - The GPU process spends about 88% of its active time in a `glFlush` that waits
    on the macOS OpenGL driver.
- **Leading hypothesis (not proven):** the way draws are issued is expensive in
  Firefox's out-of-process WebGL on macOS. Each draw writes its uniform slice
  with `bufferSubData`, rebinds it with `bindBufferRange`, then draws. That is
  1,400 to 2,800 interleaved write-then-draw sequences per frame.

## 2. Test setup

| Item             | Value                                                                         |
| ---------------- | ----------------------------------------------------------------------------- |
| Browser          | Firefox 158 on macOS 15.8.1                                                   |
| Backend profiled | WebGL2. The profiles show Apple's `GLEngine` driver in the GPU process        |
| Canvas           | 2560 x 1207 pixels (the profile's `target=` field)                            |
| MSAA             | 4x, and 1x for one run                                                        |
| Tool             | Firefox Profiler, read with `profiler-cli`                                    |
| Not measured     | WebGPU, other browsers, other operating systems, GPU model, GPU time per pass |

Each profile is one run of the in-repo benchmark page. The page URL is
`?demo=bench&scene=<scene>&n=<count>&marks` plus any extra parameters listed in
section 6. It renders for about 600 frames after 60 warm-up frames.

We have **not** measured on a second machine. Everything below is one laptop.

## 3. Engine architecture

### 3.1 Scene tree and drawing API

A scene is a tree of nodes. A `Node2D` draws by calling methods on a `Gfx2D`
object. The API looks like a canvas context, but it records instead of drawing:

```ts
class Spinner extends Node2D {
  override draw(gfx: Gfx2D): void {
    gfx.setBlend('source-over')
    gfx.fillRect(0, 0, 12, 12, '#ff0000')
  }
}
```

The call path for a frame is:

1. The engine updates nodes (`onUpdate`).
2. The stage walks the tree in paint order and calls `node.draw(gfx)` for each
   visible node.
3. `GpuGfx.endFrame()` uploads vertex data and replays what was recorded.

### 3.2 Record, then replay

`GpuGfx` implements `Gfx2D`. While nodes draw, it does not issue GPU calls.
It appends vertices to per-program vertex streams and groups consecutive
compatible draws into a _run_. A run is one GPU draw call. A new run starts when
the program, blend mode, clip or texture changes.

At frame end `GpuBatchContext.submitFrame` uploads each vertex stream once and
replays every run:

```ts
// render/gfx/GpuBatchContext.ts (abridged)
submitFrame(hooks: PassHooks | null = null): void {
  this.#recordActiveRun()
  if (this.#frameUbo) this.#writeFrame(this.#frameUbo, this.projMat)
  this.resetClipRing()
  for (const program of this.#programs.values()) {
    program.stream.upload(this.device, this.curSlot)   // one upload per stream
  }
  const runs = this.#drawRuns
  for (let i = 0; i < runs.length; i++) {
    // ... offscreen pass marks are handled here ...
    const run = runs[i]
    this.#programs.get(run.kind)?.drawRun(this, run)   // one GL draw per run
  }
}
```

A _program_ is a shader plus the code that turns a run into GPU calls. The 2D
programs are:

- `shape`: instanced quads (rectangles, circles, rounded rectangles, glyphs).
- `coloredTri`: triangle lists with per-vertex colour. Paths, strokes and
  gradient fills use it.
- `offscreenComposite`: draws an offscreen surface back into its parent.

### 3.3 Per-draw uniforms

Each run has parameters that do not fit in vertex data (paint mode, gradient
row, clip flags, debug mode). They live in a _uniform ring_: one big uniform
buffer used as an array of fixed-size slices, addressed with a dynamic offset.

```ts
// render/gfx/programs/programCommon.ts (abridged)
push(device: GfxDevice, data: ArrayBufferView): number {
  if (this.#cursor + this.#sliceBytes > this.#slots * this.#sliceBytes) {
    // grow: allocate a buffer of twice the capacity ...
  }
  const offset = this.#cursor
  device.updateUniformBuffer(this.#buffer, data, offset)  // GL: bufferSubData
  this.#cursor += this.#sliceBytes
  return offset
}
```

`drawRun` pushes a slice and then draws, **during replay**:

```ts
// render/gfx/programs/coloredTri.ts (abridged, inside drawRun)
const dynOffset = this.#drawParamsRing.push(ctx.device, s)  // bufferSubData
// ... choose the pipeline ...
ctx.device.draw({
  pipeline,
  vertexBuffers: [{ buffer: this.#stream.buffers[ctx.curSlot], offset: 0 }],
  bindGroups: [
    ctx.frameBindGroupEntry(ctx.clipOffsetForRun(run)),   // can push a clip slice
    { group: 1, bindGroup: ..., dynamicOffsets: [dynOffset] },
  ],
  vertexCount: ...,
})
```

`clipOffsetForRun` pushes a second slice into a separate clip ring when the run
has a clip. So a clipped draw performs two uniform writes before its draw.

### 3.4 The device seam

`GfxDevice` is a small interface with two implementations, `WebGL2Device` and
`WebGPUDevice`. The WebGL2 side turns the calls above into:

```ts
// render/gfx/webgl2/WebGL2Device.ts (abridged)
updateUniformBuffer(buf, data, byteOffset = 0): void {
  gl.bindBuffer(gl.UNIFORM_BUFFER, b.gl)
  gl.bufferSubData(gl.UNIFORM_BUFFER, byteOffset, data)
  gl.bindBuffer(gl.UNIFORM_BUFFER, null)
}

#applyBindGroups(call: DrawCall): void {
  // for each uniform binding with a dynamic offset:
  gl.bindBufferRange(gl.UNIFORM_BUFFER, b.binding, ubo.gl, off, b.size)
  // ... textures, samplers ...
}
```

So each run costs about this on WebGL2: `bindBuffer`, `bufferSubData`, `bindBuffer`
(per slice), then `useProgram` if the program changed, `bindBufferRange` per
uniform binding, state changes for blend, stencil and colour mask, and finally
`drawArrays`. The pipeline, blend and stencil state calls are cached and skipped
when unchanged.

### 3.5 Vector paths: stencil-then-cover

Complex or concave paths are filled with the stencil technique, because the GPU
needs nonzero and even-odd rules and cannot triangulate every frame cheaply:

1. **Fan pass:** draw a triangle fan from the first vertex of each contour with
   colour writes off. The stencil buffer counts winding (increment or decrement
   wrap for nonzero, invert for even-odd).
2. **Cover pass:** draw a bounding-box quad with the stencil test set to
   "not equal 0", which paints the covered pixels and clears the stencil.

Each filled path is therefore **two draws** (a fan run and a cover run), and they
use two different stencil states, so they cannot merge with their neighbours.
Convex solid fills skip the stencil and use one draw. The relevant code is
`fillStencilPath` in `programs/coloredTri.ts`:

```ts
// abridged: build a device-space fan for every contour, plus a bbox cover quad
this.begin(ctx, null, fanRow(rule))
const off = ctx.reserveVerts(
  this.#stream,
  fanWords + coverWords,
  triCount * 3 + 6,
)
for (let c = 0; c < flat.contourCount; c++) {
  // p0 + (p[i], p[i+1]) for every triangle of the contour
}
// ... then the cover quad with the matching cover stencil row
```

The stencil bit layout reserves bits 0-3 for winding, bit 4 for a scratch flag
and bits 5-7 for a clip depth. The exact table is in `docs/combined-depth-stencil.md`.

### 3.6 Offscreen surfaces

Some effects (track mattes, masks, opacity applied to a group of overlapping
shapes, non-trivial blend modes) draw into a temporary surface, then composite it
back. Surfaces are pooled render targets with the same format and sample count as
the main target. Replay ends the open render pass, renders the surface in its own
pass, then reopens the parent pass with `load`. None of the benchmarks below used
surfaces (`surfaces=0` in every `gfx submit` marker), so this path is not
implicated in the findings.

### 3.7 Other mechanisms worth knowing

- Vertex streams (`RingStream`) are CPU-staged, grow on demand, and upload once
  per frame per stream.
- The engine is immediate-mode. A node that is unchanged still redraws every
  frame, so per-frame CPU recording cost scales with the number of nodes.
- Per-node `performance.mark` calls are available behind `?debug=perf`. They
  cost time themselves (see section 7.3).

## 4. How a Lottie animation is drawn

`LottieNode` (`nodes/LottieNode.ts`) wraps a `LottieRenderer`
(`lottie/render/LottieRenderer.ts`). The pipeline has three stages.

1. **Parse** (once): JSON to a typed model (layers, shape items, keyframed
   properties stored in flat typed arrays).
2. **Compile** (once): the model becomes a tree of layers, groups and style
   operations. The tree owns every `GfxPath` it will draw.
3. **Evaluate then draw** (every frame):
   - `evaluate(frame)` samples the animated properties and rebuilds the paths
     whose inputs changed. It is skipped when the playback frame did not change.
   - `draw(gfx)` replays the compiled operations through `Gfx2D`.

```ts
// nodes/LottieNode.ts (abridged)
override draw(gfx: Gfx2D): void {
  if (this.#dirty) {
    this.#renderer.evaluate(this.animation.inPoint + this.#frame)
    this.#dirty = false
  }
  gfx.save()
  gfx.translate(l.x, l.y)
  gfx.scale(l.scaleX, l.scaleY)
  gfx.setClip({ kind: 'roundRect', x: 0, y: 0, w: anim.width, h: anim.height, radius: 0 })
  this.#renderer.draw(gfx, this.transform.alpha)
  gfx.restore()
}
```

Each style (fill or stroke) in a Lottie shape group paints **one compound path**
made from every path above it. Drawing a style is:

```ts
gfx.fillPath(style.compound, style.fill, rule)        // stencil fan + cover
gfx.strokePath(style.compound, strokeStyleOf(...))    // see below
```

### 4.1 Strokes

A stroke can be drawn two ways:

- **Outline stroker** (older): builds one triangle strip outline per polyline and
  draws it in one coloured-triangle run. It has artefacts on tight bends and on
  nearly closed paths.
- **Union-of-pieces stroker** (`render/gfx/pathStroke.ts`): emits a quad per
  segment, a join piece at each bend and a cap piece per cap, all wound the same
  way, then **fills the union with the nonzero rule**. That makes it a stencil
  fill, so a stroke costs **two draws and many vertices**.

`GpuGfx.strokePath` picks the union stroker when the colour is a gradient or when
the style asks for exact joins:

```ts
const geometric =
  (style.align === undefined || style.align === 'center') &&
  (typeof style.color !== 'string' || style.exactJoins === true)
```

Lottie sets `exactJoins` whenever the file's caps and joins are not both round.
This fixture uses butt caps with miter joins, so its stroke takes the expensive
route. We have not counted how common that is across other files.

### 4.2 The fixture used in the benchmarks

`abstract_circle.json` is 500 x 500, 15 fps, 51 frames, one shape layer with an
ellipse, a stroke whose width animates, a repeater and a transform. No masks, no
mattes, no gradients. Measured cost per animation:

- 28 to 54 draws per frame (varies over the loop)
- about 2 uniform slices per draw
- about 460 KB of vertex data per frame at 1080 px, about 170 KB per animation in the 50-copy runs

The vertex volume grows with on-screen size, because paths are flattened to a
tolerance based on the world scale. A bigger node gets more segments.

## 5. Instrumentation we added

With `?debug=perf` (or `&marks` on the benchmark page) the renderer emits User
Timing measures, which the Firefox Profiler shows as markers:

| Marker                                                                    | Meaning                                                  |
| ------------------------------------------------------------------------- | -------------------------------------------------------- |
| `dynamic`, `clear`, `static-render`, `above-static`                       | Frame phases in the stage                                |
| `draw node-N`, `update node-N`                                            | Per node, **expensive** at high node counts              |
| `lottie record`                                                           | One `LottieNode` recording its draws (JS only)           |
| `lottie evaluate`                                                         | Sampling an animation at a new frame                     |
| `gfx submit draws=… passes=… surfaces=… uboSlices=… bytes=… target=WxHxN` | Upload and replay, with the frame's counters in the name |
| `gfx offscreen surface WxH`                                               | One per offscreen pass                                   |
| `gfx present`                                                             | Final blit                                               |

These spans measure JavaScript time only. They contain no GPU time. Firefox drops
the `detail` payload from User Timing markers, which is why the counters are in
the marker names.

Benchmark scenes (`dev/bench.ts`):

| Scene            | Contents                                                                   |
| ---------------- | -------------------------------------------------------------------------- |
| `rects`          | `n` small rectangles, blend alternating so every rectangle is its own draw |
| `circles`        | `n` small circles that batch into a few draws                              |
| `lottie-hero`    | one animation fitted to the view (`&file=`)                                |
| `lottie-grid`    | `n` synced copies (`&file=`)                                               |
| `lottie-stagger` | `n` copies at different start frames                                       |
| `lottie-mixed`   | `n` animations cycling through all fixtures                                |

## 6. Results

All rows are one profile each, main thread, steady state. "Gap" is the time
between consecutive frames. "dynamic" is the stage's time spent in node updates
and draws for the frame. "submit" is the `gfx submit` span.

| #   | Scene and URL parameters                | MSAA | Frames | Gap p50 / p95                     | JS `dynamic` mean / p95            | `gfx submit` mean | Draws                   | Slices         | Vertex bytes  |
| --- | --------------------------------------- | ---- | ------ | --------------------------------- | ---------------------------------- | ----------------- | ----------------------- | -------------- | ------------- |
| A   | `lottie-grid&n=50&file=abstract_circle` | 4x   | 136    | 82.9 / 185.9 ms                   | 19.6 / 33.8 ms                     | 2.67 ms           | not recorded            | not recorded   | not recorded  |
| B   | same as A, counters now recorded        | 4x   | 129    | 83.1 / 193.8 ms                   | 22.1 / 38.5 ms                     | 2.77 ms           | median 1400, up to 2700 | about 2x draws | median 8.3 MB |
| C   | same as A                               | 1x   | 138    | 83.3 / 187.3 ms                   | 19.8 / 34.6 ms                     | 2.78 ms           | 1400                    | 2801           | 10.8 MB       |
| D   | `lottie-grid&n=1&file=abstract_circle`  | 1x   | 228    | 16.7 / 17.0 ms                    | 1.36 / 2.58 ms                     | 0.17 ms           | 30                      | 61             | 0.46 MB       |
| E   | `rects&n=100`                           | 1x   | 171    | 16.7 / 16.9 ms                    | 0.36 / 0.53 ms                     | 0.15 ms           | 100                     | 101            | 12 KB         |
| F   | `rects&n=1500`                          | 1x   | 56     | 87.8 / 121.0 ms (between submits) | 26.3 / 56.4 ms (inflated by marks) | 1.51 ms           | 1500                    | 1501           | 180 KB        |

### 6.1 Per-node cost (runs A to C)

| Marker                      | Mean            | p50             | p95             |
| --------------------------- | --------------- | --------------- | --------------- |
| `lottie record`, per node   | 0.38 to 0.43 ms | 0.41 to 0.46 ms | 0.66 to 0.76 ms |
| `lottie evaluate`, per node | 0.005 ms        | 0.003 ms        | 0.010 ms        |
| `gfx submit`, per frame     | 2.7 to 2.8 ms   | 2.9 to 3.1 ms   | 4.9 to 5.0 ms   |

Fifty nodes at 0.39 ms is the whole 19 to 22 ms of `dynamic`. Evaluation is not
the cost. Recording is.

Main-thread self time (run A, active samples only): 68% is one condition
variable wait, 27.5% is JavaScript. The top JavaScript self-time functions are
`#push` (3.2%), `#tryFlatten` (2.8%), `fillStencilPath` (2.1%), `emit` (2.1%),
`appendStrokeFill` (1.8%), `lineTo` (1.5%), `compactContours` (1.3%) and
`#measure` (1.1%). Garbage collection is under 1%.

### 6.2 Where the waiting is

For runs A to C the main thread's wait is under:

```
nsRefreshDriver::Tick -> PaintInternal -> WebRenderLayerManager::EndEmptyTransaction
  -> ClientWebGLContext::GetFrontBuffer        (99% of the wait)
     -> synchronous IPC to the GPU process
```

The GPU process's `CanvasRenderer` thread, in the same runs:

```
PWebGL::Msg_DispatchCommands -> WebGLParent::RecvDispatchCommands
  -> HostWebGLContext::Present -> SwapChainPresenter::SwapBackBuffer
     -> SharedSurface_IOSurface::ProducerRelease -> GLContext::fFlush
        -> GLEngine!glFlush -> dispatch_sync wait   (88% of active samples)
```

So the main thread waits for the GPU process, and the GPU process waits for the
macOS GL driver thread. We cannot see inside the driver from these profiles.

### 6.3 What the controls rule out

| Question                  | Evidence                                                | Result                                          |
| ------------------------- | ------------------------------------------------------- | ----------------------------------------------- |
| Is it fill rate or MSAA?  | A vs C: identical gap with 4x and 1x                    | No                                              |
| Is it Lottie code?        | F: 1500 trivial rectangles are as slow as 50 animations | No, not only                                    |
| Is it vertex volume?      | F uses 180 KB, A to C use 8 to 11 MB, same gap          | No                                              |
| Is it browser pacing?     | D and E run at 60 fps in the same browser               | No                                              |
| Does it scale with draws? | D (30 draws), E (100), A to C (1400), F (1500)          | Yes, roughly 55 us per draw above a few hundred |

The gap is about 83 ms in runs A to C and 88 ms in run F. The draw counts are
nearly equal (1400 and 1500), and so are the gaps. Run E at 100 draws is at
vsync, so the knee is somewhere between 100 and 1400 draws. We have not measured
the intermediate points.

## 7. Caveats and things we are unsure about

1. **Single machine.** We do not know the GPU. The `GLEngine` frames suggest
   macOS's OpenGL stack under Firefox, which may behave very differently from
   Chrome or Safari, or from WebGPU.
2. **WebGPU unprofiled.** We looked at WebGPU by eye and it looked fine. We have
   no numbers.
3. **Marks cost time.** Run F's `dynamic` mean of 26 ms is mostly 3000 marks
   per frame, not drawing. `gfx submit` and the gap are the trustworthy numbers
   there.
4. **The 55 us per draw figure is a division of unexplained time by draw count.**
   It is not a measured cost of any single call.
5. **No GPU timing.** The GPU process spends its time in a blocking wait, so we
   cannot separate command processing, driver work and actual GPU execution.
6. **Run F's main-thread wait was not broken down.** We assumed it matches runs
   A to C.

## 8. Optimization ideas we have already considered

| Idea                                                                                 | What it addresses                                  | Cost to implement                                                                            | Status                                                     |
| ------------------------------------------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Stage all uniform slices on the CPU, upload once per frame                           | Per-draw `bufferSubData` interleaved with draws    | Replay needs to split into a prepare loop and a draw loop in four programs and the clip ring | Implemented after this table was written, not yet measured |
| Pack per-draw parameters into the vertex or instance stream                          | Removes uniform slices and `bindBufferRange`       | A format change in the programs and shaders                                                  | Not started                                                |
| Batch fan draws together, then cover draws                                           | Halves the draw count for disjoint paths           | Needs a scheduler that groups by device bounds                                               | Planned as an optional item                                |
| Use the outline stroker for smooth round strokes, the union stroker only when needed | Fewer vertices, one draw instead of two            | Selection logic in `strokePath`                                                              | Not started                                                |
| Cache flattened geometry and stroke pieces for paths that did not change             | JS record cost (about 0.4 ms per node)             | Add a cache keyed by path version and scale                                                  | Not started                                                |
| Retained (static) vertex buffers for unchanged animations                            | Removes per-frame upload and recording             | Needs a static-geometry path for animated content                                            | Partly present for static paths                            |
| Rasterise small animations to a texture atlas, draw as instanced quads               | Replaces 30 draws per animation with 1 shared draw | Large                                                                                        | Not started                                                |
| Skip evaluation for off-screen nodes                                                 | CPU only                                           | Small                                                                                        | Present for playback, not for recording                    |

## 9. Questions for the reviewer

1. Is interleaving `bufferSubData` into a shared UBO with draws known to be slow
   in Firefox's remote WebGL or on macOS's GL driver? Would staging all slices
   and uploading once fix it, or would the number of `bindBufferRange` calls and
   draws still dominate?
2. We use one uniform slice per draw, addressed by dynamic offset. Would
   per-instance attributes, a texture of parameters, or a persistently mapped
   style approach be a better fit for WebGL2 on a driver like this?
3. A stencil fill costs two draws and two stencil states per path. Is there a
   cheaper strategy for many small, mostly convex or near-convex paths? For
   example a convex decomposition, a one-draw even-odd approximation, or
   tessellating once and caching.
4. Would a different strategy remove the problem entirely, such as rasterising
   each small animation frame to an atlas and drawing it as an instanced quad?
   At what size or count does that beat live vector drawing?
5. The profile only shows the main thread and the `CanvasRenderer` thread
   blocked. What is the best way to get real GPU or driver timing for WebGL in
   Firefox on macOS (for example `EXT_disjoint_timer_query_webgl2`, Metal
   System Trace, or Instruments)?
6. Does the 12 fps cliff reproduce in Chrome and Safari on the same machine? If
   it does not, is the right fix specific to Firefox's WebGL transport?
7. Is the engine's draw-per-run structure too fine-grained for Lottie in
   general, where an icon is many tiny, differently coloured paths? Should
   Lottie bypass `Gfx2D` for a dedicated instanced path renderer?

## 10. How to reproduce

1. `cd web && npm install && npm run dev -- --port 5173`
2. Open one of these URLs in Firefox and start the profiler (a preset that
   records the main thread and the GPU process works):
   - `http://localhost:5173/?demo=bench&scene=lottie-grid&n=50&file=abstract_circle&marks`
   - the same with `&msaa=1`
   - `…&scene=lottie-grid&n=1&file=abstract_circle&marks&msaa=1`
   - `…&scene=rects&n=100&marks&msaa=1`
   - `…&scene=rects&n=1500&marks&msaa=1`
3. Add `&gfx=webgl2` or `&gfx=webgpu` to force a backend.
4. Let the page run for about 10 seconds, then save the profile. The result box
   in the bottom left of the page prints the benchmark's own frame-time
   percentiles.

## 11. Follow-up after review

A reviewer agreed that interleaving `bufferSubData` with draws is a known
problem, and recommended staging uniforms first, then reducing draw count
(instancing or a parameter texture, caching tessellation, rasterising repeated
animations to an atlas). One suggestion did not apply: `earcut` cannot produce
the nonzero fill rule that Lottie needs, so it can replace the stencil fill only
for paths known to be simple. The advice to use Metal System Trace assumed
ANGLE on Metal, but the profile shows Apple's OpenGL driver in the GPU process.

**Implemented:** per-run uniform slices (the shape, coloured-triangle,
composite and clip rings) are now written into CPU staging in a prepare step and
uploaded once per ring before the first draw, so replay no longer alternates
buffer writes with draws.

**Measured after the change** (same machine and URLs as runs C and F, 1x MSAA):

| Scene                                   | Before: gap p50         | After: gap p50     | After: `gfx submit` mean | After: JS `dynamic` mean |
| --------------------------------------- | ----------------------- | ------------------ | ------------------------ | ------------------------ |
| `rects&n=1500` (1500 draws)             | 87.8 ms between submits | 16.9 ms (p95 20.2) | 1.22 ms                  | 9.2 ms (marks included)  |
| `lottie-grid&n=50&file=abstract_circle` | 83.3 ms                 | 26.1 ms (p95 41.4) | 2.50 ms                  | 19.8 ms                  |

The hypothesis holds: interleaving a buffer write with every draw was the cost.
1500 trivial draws now run at 60 fps. The Lottie scene's draw count varies over
the loop. Frames with 1400 or more draws now average 32.8 ms between frames
(123 frames), and frames with fewer than 800 draws sit at 16.5 ms. So the
remaining cost is mostly JavaScript: `lottie record` is still 0.39 ms per node
(unchanged), and `appendStrokeFill`, `#tryFlatten`, `fillStencilPath` and the
vertex writers lead the self time. Section 8's geometry caching and the outline
stroker choice are now the next candidates.

## 12. Source map

| Topic                | File                                                                      |
| -------------------- | ------------------------------------------------------------------------- |
| Drawing API          | `render/gfx/Gfx2D.ts`                                                     |
| Recording and replay | `render/gfx/GpuGfx.ts`, `render/gfx/GpuBatchContext.ts`                   |
| Uniform ring         | `render/gfx/programs/programCommon.ts` (`UboRing`)                        |
| Programs             | `render/gfx/programs/coloredTri.ts`, `shape.ts`, `offscreenComposite.ts`  |
| WebGL2 backend       | `render/gfx/webgl2/WebGL2Device.ts`                                       |
| WebGPU backend       | `render/gfx/webgpu/WebGPUDevice.ts`                                       |
| Paths and strokes    | `render/gfx/GfxPath.ts`, `render/gfx/pathStroke.ts`, `render/gfx/dash.ts` |
| Stencil recipe       | `render/gfx/stencilRecipe.ts`, `docs/combined-depth-stencil.md`           |
| Offscreen surfaces   | `render/gfx/OffscreenSurfaces.ts`                                         |
| Lottie               | `lottie/render/LottieRenderer.ts`, `nodes/LottieNode.ts`                  |
| Benchmarks           | `dev/bench.ts`, `dev/demo-lottie.ts`                                      |

All paths are relative to `web/src/stargazer/`.

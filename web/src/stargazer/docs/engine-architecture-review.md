# Stargazer engine: architecture and performance review brief

This document is written for an outside reviewer who has never seen the code. It
explains how the engine is built, how it drives WebGPU and WebGL2, what we have
measured, and where we think the foundations limit performance. We want advice
on structural changes: better batching, a more GPU-driven or compute-driven
design, and choices that suit tile-based GPUs (Apple silicon) and weak
integrated GPUs.

Paths are relative to `web/src/stargazer/` unless stated otherwise. Line numbers
were correct when this was written and will drift.

A companion report, `docs/lottie-performance-report.md`, has the full profiling
detail for the Lottie benchmarks summarized in section 9.

## Contents

1. What we want from you
2. Summary
3. Goals and constraints
4. Engine overview and frame lifecycle
5. The GPU abstraction: WebGPU and WebGL2
6. The 2D renderer
7. 3D, ambient occlusion and post-processing
8. Lottie on top of the 2D renderer
9. What we measured
10. Structural cost inventory
11. Tile-based GPUs
12. Weak GPUs
13. Directions we are considering
14. Questions for the reviewer
15. Appendix: numbers, glossary, source map

---

## 1. What we want from you

- Tell us which of the structural costs in section 10 matter most, and which do
  not.
- Tell us whether the directions in section 13 are sound, what we are missing,
  and in what order you would do them.
- Point out anything that will hurt on tile-based GPUs or weak GPUs that we have
  not noticed.
- Section 14 has specific questions.

We are open to changing the internal architecture substantially. The public
drawing API (section 6.1) is used by applications, so changes behind it are
cheaper than changes to it, but it is not frozen.

## 2. Summary

**What the engine is.** Stargazer is a TypeScript engine for interactive 2D
scenes with optional 3D. It runs in the browser on WebGPU or WebGL2 through one
device abstraction. Applications build a scene tree of nodes. 2D nodes draw
through an immediate-mode, canvas-like API every frame. 3D nodes are meshes with
forward shading.

**How 2D drawing works.** Draw calls are not sent to the GPU as they happen.
They are recorded into per-program vertex streams and grouped into _runs_. A run
becomes one GPU draw. At the end of the frame each stream is uploaded once and
the runs are replayed in painter order. Vector paths use stencil-then-cover.
Clips use either an analytic shape in the shader or stencil bits.

**What we measured** (Firefox, macOS, WebGL2, one machine):

- 1500 trivial draws per frame ran at about 12 fps. The cause was a uniform
  buffer write interleaved with every draw. Staging all per-draw uniforms and
  uploading once per frame brought the same scene to 60 fps.
- 50 small Lottie animations went from about 12 to about 38 fps with that fix.
  The rest of the cost is JavaScript that rebuilds path geometry every frame
  (about 0.4 ms per animation) and a high draw count (30 to 54 draws per small
  animation, because every filled path is two draws).
- MSAA 1x and 4x gave identical frame times. Fill rate was not the limit in
  these tests.

**The structural facts we think matter most:**

1. Everything is re-recorded and re-uploaded every frame. There is no retained
   GPU scene, no cached static layer, and no dirty-region rendering.
2. The draw is the unit of work. Batching only merges consecutive draws that
   share program, blend, clip, texture and stencil state. Paths always break
   batches.
3. Per-draw parameters live in uniform slices addressed by dynamic offset, with
   256-byte alignment for payloads of 32 to 224 bytes.
4. The canvas is never rendered to directly. Every frame ends with a full-screen
   copy into the canvas, and WebGL2 adds a second full-screen blit for the MSAA
   resolve.
5. WebGPU makes at least two queue submits per frame, more with
   post-processing or embedded viewports.
6. Offscreen effects split the main render pass, which reloads the multisampled
   target on tile-based GPUs.
7. The only compute shader is the ambient occlusion pass. Nothing else uses the
   GPU for culling, binning, tessellation or rasterization.
8. 3D creates a new bind group for every mesh draw every frame, with no culling
   or instancing, and re-renders all shadow maps every frame.

## 3. Goals and constraints

| Goal               | Detail                                                                                                               |
| ------------------ | -------------------------------------------------------------------------------------------------------------------- |
| Frame rate         | 60 fps at 3840 x 2160 with 4x MSAA                                                                                   |
| Reference hardware | Apple M1 (base), Intel Iris Xe, AMD Radeon 680M                                                                      |
| Backends           | WebGPU and WebGL2 with the same output. WebGL2 is the fallback and must stay supported                               |
| Browsers           | Chrome, Firefox, Safari. Firefox runs WebGL in a separate GPU process, so every GL call goes through a command queue |
| Language           | TypeScript in the browser. No wasm today, though it is not ruled out                                                 |
| API style          | Immediate-mode drawing for applications, scene tree for structure                                                    |
| Content            | UI-like 2D scenes, text, vector art, particles, Lottie animations, optional 3D with lights and shadows               |

Budgets we set for ourselves: under 6 ms of JavaScript per frame, no pipeline
creation inside the frame loop, no dropped draws, and under 1 MB allocated per
frame in steady state.

## 4. Engine overview and frame lifecycle

### 4.1 Building blocks

| Concept            | What it is                                                             | Where                                  |
| ------------------ | ---------------------------------------------------------------------- | -------------------------------------- |
| `Engine`           | Owns the ticker, input, animation, stages and quality settings         | `engine/Engine.ts`                     |
| `Stage`            | One canvas, one GPU device, one 2D renderer, one scene tree            | `render/Stage.ts`                      |
| `SceneTree`        | Root node plus painter-order lists per render layer                    | `scene/SceneTree.ts`                   |
| `Node2D`           | A 2D node with a transform, an optional `draw(gfx)` and a render layer | `scene/Node2D.ts`                      |
| `MeshNode`, lights | 3D nodes                                                               | `nodes/`, `render/gfx/MeshRenderer.ts` |
| `Viewport2DNode`   | A 2D scene rendered into a texture, shown on a 3D mesh                 | `nodes/Viewport2DNode.ts`              |
| `GpuGfx`           | The 2D renderer, implements the `Gfx2D` API                            | `render/gfx/GpuGfx.ts`                 |
| `GfxDevice`        | The backend seam, implemented by `WebGPUDevice` and `WebGL2Device`     | `render/gfx/GfxDevice.ts`              |

### 4.2 Ticker and engine frame

The ticker is driven by `requestAnimationFrame` (`engine/Ticker.ts`).

- `dt` is smoothed with an exponential moving average (weight 0.15) that snaps
  to the raw value on a jump of more than 50%. It is clamped to 1/30 s.
- A fixed step (default 120 Hz) runs from an accumulator, at most 8 steps per
  frame, before the frame callback.
- An optional frame-rate cap skips early frames.

`Engine.#frame(dt)` (`engine/Engine.ts:491-561`) runs, in order:

1. `onBeforeFrame` hooks (camera movement).
2. Input for each stage.
3. Tweens (`animation.tick`).
4. The update walk: visits every node in every stage, calls `onUpdate` and
   behaviours where a node has update work.
5. Layout for dirty layout roots.
6. `stage.updateTransforms()`: recomputes world matrices for dirty nodes.
7. `stage.render(dt)` for each stage.
8. Emits `frame`.

The fixed step walks every stage's whole tree again for `onFixedStep`. At 60 Hz
display and 120 Hz fixed step that is about two extra full-tree walks per frame.

### 4.3 Stage render phases

`Stage.#renderFrame` (`render/Stage.ts:385-651`), in order:

| #   | Phase                  | Notes                                                                                     |
| --- | ---------------------- | ----------------------------------------------------------------------------------------- |
| 1   | Resolve cameras        | Fold device pixel ratio into the 2D camera matrix                                         |
| 2   | Decide on 3D           | `tree.has3D` is a depth-first search every frame, so a pure 2D scene walks the whole tree |
| 3   | Attach or detach depth | Changing attachments rebuilds the target and re-warms every pipeline                      |
| 4   | Readiness gate         | Skip the frame while pipelines compile                                                    |
| 5   | Path-shadow bakes      | Blurred shadow masks requested last frame, rendered in their own passes (section 6.9)     |
| 6   | 3D render-to-texture   | Each visible `Viewport2DNode` renders its 2D scene                                        |
| 7   | Shadow maps            | Every frame, all casters into every shadow layer and cube face                            |
| 8   | Ambient occlusion      | Optional, G-buffer prepass plus compute or fragment passes                                |
| 9   | Clear                  | `screen.beginFrame()` opens the main render pass                                          |
| 10  | 3D pass                | Meshes drawn immediately into the open main pass                                          |
| 11  | 2D layers              | Static, above-static and dynamic layers recorded in that order                            |
| 12  | Debug overlays         | Optional                                                                                  |
| 13  | End of frame           | Replay the 2D command list, close the pass, then post-processing or present               |

The three 2D render layers are draw order only. There is no cached static
layer. A static-invalidation flag exists in `SceneTree` but nothing reads it.

### 4.4 Passes per frame

| Frame type                   | Render passes                                                                              | Queue submits (WebGPU) |
| ---------------------------- | ------------------------------------------------------------------------------------------ | ---------------------- |
| 2D only, MSAA 4x, no effects | Main pass (resolved in-pass), then a present blit into the canvas                          | 2                      |
| 2D, WebGL2                   | Main pass, MSAA resolve blit, present blit                                                 | n/a                    |
| 2D with offscreen effects    | Main pass split into segments, one pass per surface, plus a final resolve pass             | 2                      |
| 3D scene                     | Up to 4 shadow-array passes and 6 cube-face passes, optional AO passes, main pass, present | 2                      |
| Each `Viewport2DNode`        | 1+ passes                                                                                  | +1                     |
| Post-processing              | One full-screen pass per effect pass, then the present blit                                | +1                     |

## 5. The GPU abstraction: WebGPU and WebGL2

### 5.1 The seam

`GfxDevice` (`render/gfx/GfxDevice.ts`) is modelled on WebGPU:

- **Handles:** shader modules, pipelines, compute pipelines, bind group layouts,
  bind groups, vertex, index and uniform buffers, textures, render targets,
  shadow arrays and shadow cubes.
- **Pipelines** bake shader, vertex layout, bind group layouts, colour format
  and blend, write mask, depth and stencil state, depth-stencil format, cull
  mode, topology and sample count. They are created asynchronously and memoized
  by a key. Only the stencil reference and the scissor are dynamic per draw.
- **Bindings:** uniform buffers (optionally with a dynamic offset), 2D
  textures, shadow array and cube textures, a depth texture, and a storage
  texture (WebGPU only). No storage buffers.
- **Render passes:** one colour attachment with load (clear or load) and store
  (store or discard), an optional resolve target, optional depth and stencil
  attachments with their own load and store.
- **Draw calls:** pipeline, vertex buffers with byte offsets (offsets stand in
  for base instance), bind groups with dynamic offsets, optional index buffer,
  counts, instance count, stencil reference, scissor.
- **Compute:** create a compute pipeline, begin a compute pass, dispatch, end.
  Not available on WebGL2.
- **Formats:** RGBA8 linear or sRGB colour, single-sample R8 and RG8, and four
  depth-stencil configurations. No float colour targets.
- **No indirect draws, no storage buffers, no timestamp queries, no multi-draw.**

### 5.2 WebGPU backend

`render/gfx/webgpu/WebGPUDevice.ts`:

- One command encoder per frame, opened by the first pass. `endFrame` finishes
  and submits it.
- `present` submits the frame encoder, then records a full-screen-triangle blit
  from the resolved image into the canvas texture on a second encoder and
  submits again (`blitPass.ts`).
- Uploads use `queue.writeBuffer`. Writes that are not a multiple of 4 bytes go
  through a newly allocated padding array.
- Buffers and textures deleted while an encoder is open are destroyed after the
  submit.
- Per draw, `setPipeline` is skipped when unchanged. `setVertexBuffer` and
  `setBindGroup` are issued on every draw without a redundancy check.
- `createBindGroup` creates a new texture view for every texture entry every
  time.
- No render attachment uses `TRANSIENT_ATTACHMENT`.
- Sample count is clamped with `Math.min(4, floor(samples))`, so a requested 2x
  is passed through. WebGPU only accepts 1 or 4. We have not tested this.

### 5.3 WebGL2 backend

`render/gfx/webgl2/WebGL2Device.ts`:

- The context has no antialiasing, depth or stencil. All rendering goes to
  framebuffer objects.
- Shaders are compiled and linked synchronously. `KHR_parallel_shader_compile`
  is not used.
- A pipeline is a record of state. Program, blend, colour mask, stencil, depth,
  cull and scissor setters skip redundant calls.
- Bind groups are applied per draw with `bindBufferRange` or `bindBufferBase`
  for every uniform buffer entry, without caching. Texture binds skip redundant
  units.
- Vertex array objects are cached per pipeline, keyed by a string built from the
  buffer ids on every draw. When a vertex buffer offset changes,
  `vertexAttribPointer` is re-issued, which is how ring sub-ranges and base
  instance are emulated.
- MSAA resolve is `blitFramebuffer` after the pass, followed by
  `invalidateFramebuffer` for discarded colour and stencil-only attachments.
  Combined depth-stencil is never invalidated.
- Present is another `blitFramebuffer` into the default framebuffer.

### 5.4 Shaders

Shaders are written once in WGSL (`render/gfx/shaders/*.wgsl`). A Rust tool,
`crates/shader-gen`, uses naga to emit GLSL ES 3.00 vertex and fragment shaders
plus a reflection file with uniform block and sampler names. Compute shaders are
WGSL only. Programs import both and the device picks one.

## 6. The 2D renderer

### 6.1 The public drawing API

Nodes draw through `Gfx2D` (`render/gfx/Gfx2D.ts`), which resembles the Canvas
2D API:

```ts
class Badge extends Node2D {
  override draw(gfx: Gfx2D): void {
    gfx.save()
    gfx.setBlend('source-over')
    gfx.fillRect(0, 0, 120, 40, '#223344')
    gfx.fillPath(this.icon, '#ffcc00', 'nonzero') // this.icon is a GfxPath
    gfx.restore()
  }
}
```

It covers rectangles, circles, rounded rectangles, analytic shadows, lines,
polylines and curves, text, images, gradients, paths (`GfxPath`, a reusable
mutable path), clips (`setClip` for analytic shapes, `clipPath` for arbitrary
paths), blend modes, a transform stack, and offscreen surfaces
(`beginOffscreen` and `endOffscreen`).

The walker (`render/StageLayerRenderer.ts`) visits nodes in painter order, sets
the node's world transform and alpha, and calls `draw`. It culls only nodes that
declare bounds, and it walks ancestors per node for visibility and clips.

### 6.2 Recording and replay

`GpuGfx` turns each call into vertex or instance records appended to the stream
of the program that draws it. The batch context (`GpuBatchContext.ts`) keeps one
_active batch_. A new run starts when any of these changes: program, blend,
texture, lookup texture, clip, clip mask, paint, stencil row or clip depth. Each
finished run is a `DrawRun` record holding the stream range and the captured
state.

At `endFrame`, `submitFrame`:

1. Uploads each program's stream once.
2. Runs a prepare step: for every run, writes its clip slice and its program's
   parameter slice into CPU staging.
3. Uploads each staged uniform ring once.
4. Replays the runs in order. Each run is one GPU draw. Offscreen pass marks in
   the list end and reopen render passes.

```ts
// render/gfx/GpuBatchContext.ts (abridged)
for (const program of this.#programs.values()) {
  program.stream.upload(this.device, this.curSlot)
}
for (const run of runs) {
  this.#stageClip(run)
  this.#programs.get(run.kind)?.prepareRun?.(this, run)
}
this.#clipRing?.flush(this.device)
for (const program of this.#programs.values()) program.flushRings?.(this.device)
for (let i = 0; i < runs.length; i++) {
  // pass marks for offscreen surfaces are handled here
  this.#programs.get(runs[i].kind)?.drawRun(this, runs[i])
}
```

Steps 2 and 3 are new. Before them, every draw wrote its uniform slice
immediately before drawing (section 9).

### 6.3 Programs

| Program               | Draws                                                            | Geometry            | Record size        | Per-draw uniforms                         |
| --------------------- | ---------------------------------------------------------------- | ------------------- | ------------------ | ----------------------------------------- |
| `shape`               | Circles, rounded rects, analytic shadows, atlas and label quads  | Instanced unit quad | 112 B per instance | 32 B slice                                |
| `coloredTri`          | Fills, paths, polygons, stencil fans and covers, outline strokes | Triangle list       | 20 B per vertex    | 64 B slice, or 96 B for retained geometry |
| `stroke`              | Lines, curves, polylines                                         | Instanced           | 36 B               | Static                                    |
| `gradientRadial`      | Radial gradient circles                                          | Instanced           | 24 B               | none                                      |
| `maskedGradient`      | Mask times radial gradient                                       | Instanced           | 52 B               | none                                      |
| `textQuad`            | Large labels, per-image draws                                    | Instanced           | 44 B               | none                                      |
| `pathShadowComposite` | Cached blurred path shadows                                      | Instanced           | 48 B               | none                                      |
| `shaderQuad`          | User shader quads                                                | Instanced           | 32 B               | Ring of 512                               |
| `offscreenComposite`  | Composites an offscreen surface                                  | 6 vertices per quad | 16 B per vertex    | 16 B slice                                |

Every program warms a pipeline per blend variant (`source-over` and `lighter`
by default) times its stencil variants: plain, clip test, and any program
specific rows such as fan and cover.

All runs also bind group 0: a 64-byte frame uniform buffer and a 32-byte clip
slice with a dynamic offset.

**Uniform slice alignment.** Slices are padded to
`minUniformBufferOffsetAlignment`, 256 bytes on common hardware. A 32-byte clip
slice uses 256 bytes, so 1500 runs upload about 384 KB of clip data for about
48 KB of payload.

### 6.4 Vertex streams

`RingStream` (`render/gfx/RingStream.ts`) is a CPU staging buffer with a float
and a uint view, plus one GPU buffer per ring slot (`RING_SIZE` is 2). Records
are appended during the frame. `upload` writes the used range once and recreates
the GPU buffer when it outgrew it. Streams double on demand and halve after 60
quiet frames.

### 6.5 Paths: stencil-then-cover

`GfxPath` (`render/gfx/GfxPath.ts`) stores verbs and points, flattens curves to
a tolerance tied to the world scale (half-octave buckets, cached by path version
and bucket), drops repeated points, and tests convexity.

`fillPath`:

- Convex solid fills draw as one triangle fan without stencil.
- Everything else draws a **fan** (triangles from each contour's first vertex,
  colour writes off, stencil counts winding) and a **cover** (a bounding-box
  quad that paints where the stencil is non-zero and clears it). That is two
  runs per path with different stencil states, so paths never batch with each
  other.

The stencil byte is shared between paths and clips. Bits 0 to 3 count winding
(mod 16), bit 4 is a scratch flag, bits 5 to 7 hold the clip depth (up to 7
nested path clips). The full recipe table is in `docs/combined-depth-stencil.md`
and `render/gfx/stencilRecipe.ts`.

`strokePath` has two strategies:

- An outline stroker that emits one triangle strip per polyline. One run, few
  vertices, but it can fold over itself on tight bends.
- A union-of-pieces stroker (`render/gfx/pathStroke.ts`) that emits a quad per
  segment plus join and cap pieces and fills the union with the nonzero rule.
  Correct in all cases, but it is a stencil fill (two runs) with many vertices.
  It is used for gradient strokes and when exact joins are requested.

### 6.6 Clips

- **Analytic clips** (`setClip`): a rectangle, rounded rectangle or circle
  passed to the shader as the 32-byte clip slice. The fragment shader computes
  coverage. No stencil, but it costs a slice per clipped run.
- **Path clips** (`clipPath`): push a fan into the stencil and raise the clip
  depth, scoped by `save` and `restore`. Draws inside test the depth bits.
- **Subtree clips** (`Node2D.clip`): the walker brackets a subtree with a clip
  push and pop.
- A pixel-aligned rectangle could be a scissor. That fast path is not done.

### 6.7 Offscreen surfaces

`beginOffscreen` and `endOffscreen` draw content into a pooled render target with
the same format and sample count as the main target, then composite it with
opacity, a blend mode, or a matte (alpha, luma, inverted). They implement group
opacity, track mattes and masks for Lottie.

Recording writes pass marks into the run list. During replay a mark ends the
open pass, renders the surface in its own pass, resolves it, and reopens the
parent pass with `load`. A frame that might use surfaces is decided at frame
start (`addOffscreenDemand`): if any node has declared it, the main pass stores
its multisampled colour and stencil instead of discarding them, and a final pass
resolves them.

Surfaces are sized to their content bounds rounded up to 64 px. They are not
budgeted and not packed into atlases.

### 6.8 Text and textures

- Text is rasterized with Canvas2D `fillText`, a whole line at a time, and
  uploaded into a 2048 x 2048 label page (`render/gfx/rasterizeLabel.ts`,
  `TextureManager.ts`). There is no glyph atlas and no SDF text.
- Labels are cached by text, font, colour and a scale bucket (ratio 2^(1/3)),
  at most 24 re-rasterizations per frame and 768 cached labels. The page is
  mirrored in a CPU canvas for context loss.
- Page labels draw through `shape` and batch. Labels larger than 512 px get their
  own texture and draw through `textQuad`.
- Gradients use a 256 x 64 ramp atlas painted row by row through Canvas2D.
  More than 64 distinct gradients in one frame fall back to solid colours.
- Particle sprites share a 1024 x 1024 atlas. Other images get one mipmapped
  texture each, so each image is a texture switch and a new run.

### 6.9 Path shadows

Blurred drop shadows of arbitrary paths are baked into small masks
(`render/gfx/PathShadowCache.ts`): raster at 2x into R8, then two separable blur
and downsample passes into RG8. Three render passes per bake. Bakes requested in
frame N run before the main pass of frame N+1, under a work budget. Each bake
creates and deletes its own vertex and index buffers. Rounded rectangles and
circles use an analytic shadow in the `shape` shader instead.

## 7. 3D, ambient occlusion and post-processing

### 7.1 Meshes

`render/gfx/MeshRenderer.ts` is a forward renderer with a flat program and a PBR
program (GGX, up to 8 lights, fog, optional toon steps). Meshes draw immediately
into the main pass before the 2D replay.

Per frame:

- A full-tree walk collects meshes, viewports and lights.
- Opaque meshes are not sorted by state. Transparent meshes are sorted back to
  front.
- No frustum culling, no instancing.
- Each draw writes a uniform slice (96 or 224 B, padded to 256) with an
  immediate `updateUniformBuffer`, and creates a new bind group (up to 7
  entries). On WebGPU that means a new `GPUBindGroup` and a new texture view per
  texture, per mesh, per frame.
- Vertex attributes live in separate buffers (position, normal, UV, tangent).

### 7.2 Shadows

- Directional and spot lights share a depth texture array of up to 4 layers
  (default 1024 x 1024). The first point light gets a 6-face cube.
- All casters render into every layer and face, every frame. One depth pass per
  layer or face.
- PBR sampling uses PCF with 1, 4, 9 or 16 taps.

### 7.3 Ambient occlusion

Optional. A G-buffer prepass draws every opaque mesh again into a full-resolution
RGBA8 target (octahedral normal plus 16-bit depth). Then:

- **WebGPU:** one compute pass, three dispatches (generate, blur horizontal,
  blur vertical), workgroups of 8 x 8, storage textures.
- **WebGL2:** three full-screen fragment passes.

This is the only compute work in the engine. It runs at full resolution with no
temporal reuse.

### 7.4 Post-processing

`render/postfx/PostProcessPipeline.ts` runs each effect pass as its own
full-screen render pass into a pooled single-sample target (vignette, chromatic
aberration, separable blur, dual Kawase blur, film grain). Effects are not
fused. The last pass writes to a pooled target that is then blitted to the
canvas, one copy more than needed.

### 7.5 Embedded viewports

A `Viewport2DNode` owns a separate `GpuGfx` on the same device: its own streams,
rings, label page (16 MB), sprite atlas and path-shadow cache. It renders every
frame, single-sample, and submits separately on WebGPU.

## 8. Lottie on top of the 2D renderer

Lottie animations are scene nodes (`nodes/LottieNode.ts`). A file is parsed once
into a typed model, compiled once into a tree of layers, groups and style
operations that own their `GfxPath`s, then each frame:

- `evaluate(frame)` samples animated properties and rebuilds changed paths. It
  is skipped when the frame did not change. It is cheap (5 us per animation in
  our tests).
- `draw(gfx)` replays the compiled operations through `Gfx2D`: `fillPath` or
  `strokePath` per style, nested transforms per group, `clipPath` for precomp
  bounds and simple masks, offscreen surfaces for mattes, complex masks, group
  opacity and blend modes.

Every frame, even with an unchanged animation frame, `draw` re-flattens,
re-transforms to device space and re-emits all geometry, because the renderer is
immediate-mode. A small icon with a stroked, repeated circle produces 30 to 54
draws per frame.

## 9. What we measured

All measurements: Firefox 158, macOS 15.8.1, WebGL2 (the GPU process showed
Apple's OpenGL driver), canvas 2560 x 1207, Firefox Profiler. One machine. We
have not profiled WebGPU or other browsers.

### 9.1 Before the uniform staging change

| Scene                | MSAA | Draws | Uniform slices | Vertex data | Frame gap (median) |
| -------------------- | ---- | ----- | -------------- | ----------- | ------------------ |
| 1 Lottie animation   | 1x   | 30    | 61             | 0.46 MB     | 16.7 ms            |
| 100 rectangles       | 1x   | 100   | 101            | 12 KB       | 16.7 ms            |
| 50 Lottie animations | 4x   | 1400  | 2800           | 8.3 MB      | 83.1 ms            |
| 50 Lottie animations | 1x   | 1400  | 2801           | 10.8 MB     | 83.3 ms            |
| 1500 rectangles      | 1x   | 1500  | 1501           | 180 KB      | 87.8 ms            |

- MSAA made no difference. Vertex volume made no difference. Draw count did.
- The main thread spent about two thirds of its time blocked in a synchronous
  call to the GPU process (`ClientWebGLContext::GetFrontBuffer`). The GPU process
  spent about 88% of its time in `glFlush`, waiting on the GL driver.
- Each draw then wrote a uniform slice with `bufferSubData` immediately before
  drawing. An outside reviewer pointed out that updating a buffer the GPU may
  still be reading forces the driver to stall or to shadow the buffer, and that
  out-of-process WebGL makes this worse.

### 9.2 After the uniform staging change

All per-draw slices are now written to CPU staging and uploaded with one write
per ring before the first draw.

| Scene                | Frame gap before | Frame gap after | JS for the 2D draw phase after       |
| -------------------- | ---------------- | --------------- | ------------------------------------ |
| 1500 rectangles      | 87.8 ms          | 16.9 ms         | 9.2 ms (inflated by profiling marks) |
| 50 Lottie animations | 83.3 ms          | 26.1 ms         | 19.8 ms                              |

In the Lottie scene the draw count changes during the loop. Frames with 1400 or
more draws average 32.8 ms, frames with under 800 draws run at 16.5 ms.

### 9.3 What is left

- **JavaScript.** Recording one small animation costs about 0.39 ms. The top
  self-time functions are the union stroker (`appendStrokeFill`), path
  flattening (`#tryFlatten`), fan emission (`fillStencilPath`) and vertex
  writers. Evaluation is negligible. The cost is regenerating geometry that
  mostly did not change.
- **Draw count.** Two draws per filled path, plus pipeline and stencil state
  changes between fan and cover, plus a uniform slice per draw.
- **Unknown GPU time.** We have no GPU timing. Firefox does not expose timer
  queries to us here, and the waits we saw were in the driver.

## 10. Structural cost inventory

Each item lists what happens, why it costs, and the evidence. Items marked
_inferred_ are from reading the code, not from measurement.

### 10.1 CPU (JavaScript)

| Cost                        | Detail                                                                                                                  | Evidence                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| Immediate-mode re-recording | Every node re-emits all its geometry every frame, changed or not                                                        | Measured: 0.39 ms per small Lottie animation |
| Path work per frame         | Flatten, transform to device space, emit fans and covers, build stroke pieces                                           | Measured: top self-time functions            |
| Full-tree walks             | Update, fixed step (about 2 per frame), 3D transform walk and `has3D` search even in pure 2D scenes, plus the draw walk | Inferred                                     |
| Per-node ancestor walks     | Visibility, clip sync and inset checks walk ancestors for each node                                                     | Inferred                                     |
| Label cache keys            | A string key is built for every `fillText` call                                                                         | Inferred                                     |
| 3D per-draw bind groups     | New bind group per mesh per frame                                                                                       | Inferred                                     |
| Transforms                  | `DOMMatrix` used to rebuild local matrices, a new one per skewed node                                                   | Inferred                                     |

### 10.2 API and driver

| Cost                                 | Detail                                                                                                                      | Evidence                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Draw count                           | One draw per run, two per path, batch breaks on any state change                                                            | Measured: cost follows draws              |
| Interleaved buffer writes            | Fixed for the 2D programs. 3D and path shadows still write per draw                                                         | Measured for 2D                           |
| Redundant binding                    | WebGPU `setBindGroup` and `setVertexBuffer` on every draw. WebGL2 `bindBufferRange` on every draw, VAO key strings per draw | Inferred                                  |
| Uniform padding                      | 32 to 224 B payloads padded to 256 B                                                                                        | Inferred, about 8x upload for clip slices |
| Several submits                      | 2+ per frame on WebGPU                                                                                                      | Inferred                                  |
| Pipeline permutations                | Program x blend x stencil row, all prewarmed                                                                                | Inferred, affects startup and memory      |
| Synchronous shader compile on WebGL2 | No parallel compile extension                                                                                               | Inferred, affects startup                 |

### 10.3 GPU work and bandwidth

| Cost                     | Detail                                                                               | Evidence                                                          |
| ------------------------ | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| Present copy             | A full-screen copy every frame on both backends, plus a resolve blit on WebGL2       | Inferred                                                          |
| Stencil fill rate        | Fan covers the path's area with overlapping triangles, cover covers its bounding box | Inferred. Not visible in our tests, may matter at 4K on weak GPUs |
| Pass splits for surfaces | Each surface ends the main pass and reloads it                                       | Inferred                                                          |
| Depth always stored      | The main pass stores depth even when it is the last use                              | Inferred                                                          |
| Shadows                  | All casters into all layers every frame                                              | Inferred                                                          |
| Post-processing          | One full-screen pass per effect pass, not fused, plus an extra copy                  | Inferred                                                          |
| AO                       | Full-resolution G-buffer and three full-resolution passes                            | Inferred                                                          |

### 10.4 Memory

At 1920 x 1080 with 4x MSAA: colour 33 MB, stencil 8 MB, resolve 8 MB. With 3D,
a 33 MB depth-stencil replaces the stencil. Each 2D renderer (each stage and
each embedded viewport) adds a 16 MB label page and a 4 MB sprite atlas.
Offscreen surfaces each match the main sample count. At 4K these figures
quadruple. Nothing uses memoryless or transient attachments.

## 11. Tile-based GPUs

Apple silicon and most mobile GPUs render in tiles held in on-chip memory.
Loading an attachment at pass start and storing it at pass end are the
expensive operations. Multisampled attachments that are resolved in the pass and
never stored can stay entirely on chip.

**What we do well:**

- The main pass resolves MSAA colour in the pass and discards the multisampled
  samples when the pass is the last use (WebGPU `resolveTarget` with
  `storeOp: 'discard'`).
- Stencil is discarded at the end of the final segment.
- Clears use `loadOp: 'clear'`, never a full-screen clear draw.

**What hurts or might hurt:**

1. **Pass splits.** Any frame where a node has declared offscreen demand stores
   the multisampled colour and stencil, splits the main pass for each surface,
   and reloads with `loadOp: 'load'`. At 4K with 4x MSAA a reload is about
   130 MB of colour traffic per split.
2. **Depth is always stored**, even when nothing reads it afterwards.
3. **The present blit** is an extra full-screen pass. Rendering the last segment
   straight into the canvas texture (or resolving into it) would avoid it.
4. **WebGL2 resolve** is a `blitFramebuffer` after the pass. Whether the browser's
   GL-on-Metal layer can fold that into the pass is outside our control.
5. **No transient attachments.** WebGPU implementations may expose memoryless
   storage for attachments that are never stored; we do not request it.
6. **Shadow maps and AO** add full passes and full-resolution targets every
   frame.
7. **Many small passes.** Path-shadow bakes are three passes each. Each surface
   is a pass. Each post effect is a pass.

## 12. Weak GPUs

Integrated GPUs such as Iris Xe have little bandwidth and fill rate at 4K.

- **No automatic quality scaling.** Knobs exist (`msaaSamples`, `renderScale`,
  shadow map size, PCF taps, AO preset, path-shadow budgets) but nothing adjusts
  them from measured frame time.
- **MSAA is the only antialiasing for paths.** Lowering it degrades every path
  edge. Analytic antialiasing exists for circles, rounded rectangles and
  strokes in the `shape` and `stroke` shaders, but not for general paths.
- **Stencil fills** cost fan area plus bounding box area per path. Thin
  diagonal shapes have bounding boxes much larger than their area.
- **Full-resolution effects** (AO, blur) have no half-resolution option except
  per-pass scale in post-processing.
- **Draw and state cost** matters more on slow drivers, as section 9 showed.

## 13. Directions we are considering

These are ideas, not decisions. For each we list what it changes and what we are
unsure about.

### 13.1 Cut per-draw state: uber-shader and per-instance data

**Idea.** Replace per-draw uniform slices with per-instance or per-vertex data.
Either put the draw parameters (paint mode, gradient, clip) in the instance
stream, or write them into a storage buffer (WebGPU) or a data texture (WebGL2)
and give each instance an index. Merge `coloredTri`, `shape`, `gradientRadial`,
`maskedGradient` and `textQuad` into fewer programs that switch on a paint mode.

**Changes.** Runs would break only on blend, render target, stencil row and
texture binding. Clip slices disappear. Bind groups become static per frame.

**Unsure about.** Fragment shader cost of a larger uber-shader on weak GPUs,
especially with the analytic clip. How to handle textures without bindless
(texture arrays or atlases, and their size limits on WebGL2).

### 13.2 Fewer draws for paths

Options we know of, from least to most change:

1. **Batch fans and covers.** Collect paths whose device bounds do not overlap
   and draw all their fans in one draw, then all their covers in one draw.
   Keeps stencil-then-cover. Needs a scheduler that respects painter order.
2. **Cache tessellation.** Triangulate paths on the CPU once (with a
   nonzero-capable tessellator, since simple ear clipping only handles simple
   polygons) and reuse the triangles while the path is unchanged. Draws become
   plain coloured triangles that batch with everything else. Animated paths
   would still re-tessellate.
3. **Analytic coverage.** Compute coverage per pixel from the curves themselves
   (curve rendering in the fragment shader, or signed distance for simple
   shapes). Gives antialiasing without MSAA. More shader cost, harder for
   complex paths.
4. **GPU compute rasterization.** Flatten, bin into tiles and compute coverage
   in compute shaders, then composite. Draw count stops mattering. WebGPU only,
   with a fallback needed for WebGL2.

### 13.3 Retain geometry between frames

**Idea.** Keep per-node GPU geometry and only re-upload what changed. A node
that did not change would add one instanced or indexed draw with a matrix, not
regenerate its vertices. Lottie frames that repeat (loops, synchronized copies)
could share geometry.

**Unsure about.** Memory budget, how to keep painter order and batching when
geometry lives in many buffers, and how this interacts with the immediate-mode
API.

### 13.4 Raster caches

**Idea.** Render small, repeated content (icons, Lottie at small sizes, static UI
panels) into an atlas once per content change and draw it as a textured quad.
50 synchronized copies of one animation become one rasterization plus one
instanced draw. A static layer cache with dirty rectangles is a related idea.

**Unsure about.** When the cache wins (size, count, change rate), resampling
quality under scale and rotation, and atlas memory at 4K.

### 13.5 A frame graph

**Idea.** Declare passes and their attachments up front for the whole frame
(shadow maps, AO, 3D, 2D segments, surfaces, post effects, present), then
derive load and store ops, reuse transient targets, merge or reorder passes,
render the last pass directly into the canvas, and submit once.

**Changes.** Removes the present blit, makes depth discard automatic, lets
offscreen surfaces render before the main pass instead of splitting it, and
gives one place to apply transient attachments.

**Unsure about.** Reordering surfaces before the main pass requires knowing the
surfaces at record time, which we do (they are recorded), but nested surfaces
and 3D drawn into the main pass complicate it.

### 13.6 Compute-driven 2D

**Idea.** On WebGPU, move more work to compute: transform and cull instances,
expand stroke and path geometry, sort or bin by tile, and issue indirect draws.
Keep a simpler path for WebGL2.

**Unsure about.** How much of our cost would actually move (our measured costs
were JS geometry generation and draw count), and whether maintaining two
substantially different paths is worth it.

### 13.7 Submission and binding hygiene

Smaller, independent improvements:

- One submit per frame on WebGPU, including present and post-processing.
- Skip redundant `setBindGroup`, `setVertexBuffer` and `bindBufferRange` calls.
- Cache bind groups and texture views for 3D and post-processing.
- Pack small uniform payloads so one 256-byte slice holds several draws, or
  move them out of uniforms entirely (13.1).
- Use `KHR_parallel_shader_compile` on WebGL2.

### 13.8 Adaptive quality

Measure frame time and adjust render scale, MSAA, shadow and AO quality, and
path-shadow budgets to hold the frame rate. On WebGPU, GPU timestamps would
let this react to GPU cost rather than total frame time.

### 13.9 Rendering off the main thread

Render from a worker with `OffscreenCanvas`, keeping input and application
logic on the main thread. The scene would need a way to cross threads (shared
buffers or a command protocol).

## 14. Questions for the reviewer

1. Given our numbers, should we invest first in fewer draws (13.1, 13.2) or in
   less JavaScript per frame (13.3, 13.4)? Do they need to be designed together?
2. For many small vector paths per frame, which path rendering approach would
   you choose for both WebGPU and WebGL2: batched stencil-then-cover, cached CPU
   tessellation, analytic coverage, or compute rasterization with a fallback?
3. What is the best replacement for per-draw dynamic-offset uniforms on WebGL2:
   instance attributes, a float data texture with `texelFetch`, or something
   else? How large can a data texture get before it hurts on weak GPUs?
4. On Apple silicon, how much does the present blit cost at 4K, and what is the
   best way to render or resolve straight into the canvas texture on WebGPU and
   on WebGL2?
5. Is the replay-time pass split for offscreen surfaces acceptable if surfaces
   are rare, or should surfaces always render before the main pass?
6. Do current browsers expose transient (memoryless) attachments in WebGPU in a
   way we can rely on?
7. Is MSAA the right default for vector antialiasing on weak GPUs at 4K, or
   should we move to analytic antialiasing and keep MSAA for 3D only?
8. How would you get reliable GPU timing on macOS for WebGL and WebGPU during
   development?
9. Is a frame graph worth it at our scale, or is a fixed pass order with
   explicit load and store choices enough?
10. Would you keep one engine with two backends, or treat WebGPU as the primary
    design and WebGL2 as a reduced fallback with fewer features?

## 15. Appendix

### 15.1 Key numbers

| Item                         | Value                                 |
| ---------------------------- | ------------------------------------- |
| Ring slots for streams       | 2                                     |
| `coloredTri` vertex          | 20 B                                  |
| `shape` instance             | 112 B                                 |
| Frame uniform                | 64 B                                  |
| Clip slice payload           | 32 B, padded to 256 B                 |
| `coloredTri` draw parameters | 64 B (96 B retained), padded to 256 B |
| `shape` parameters           | 32 B, padded to 256 B                 |
| Mesh object uniforms         | 96 B flat, 224 B PBR, padded to 256 B |
| Label page                   | 2048 x 2048 RGBA8 per 2D renderer     |
| Sprite atlas                 | 1024 x 1024 RGBA8 per 2D renderer     |
| Gradient ramp atlas          | 256 x 64                              |
| Shadow array                 | up to 4 layers, default 1024 px       |
| Path clip depth              | up to 7                               |
| Winding count                | mod 16                                |
| MSAA default                 | 4x                                    |

### 15.2 Glossary

- **Run:** a recorded range of one program's stream plus the state it needs.
  One run is one GPU draw.
- **Stencil-then-cover:** fill a path by counting winding in the stencil buffer
  with a fan, then painting a cover where the stencil is non-zero.
- **Analytic clip:** a clip shape evaluated in the fragment shader instead of
  in the stencil buffer.
- **Offscreen surface:** a temporary render target for content that must be
  composited as a group.
- **Pass split:** ending a render pass to render something else, then resuming
  the first pass with `loadOp: 'load'`.
- **Tile-based GPU:** a GPU that renders screen tiles in on-chip memory and
  writes them out at pass end.

### 15.3 Source map

| Area              | Files                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| Frame loop        | `engine/Ticker.ts`, `engine/Engine.ts`, `render/Stage.ts`                                                  |
| Scene             | `scene/SceneTree.ts`, `scene/Node2D.ts`, `render/StageLayerRenderer.ts`                                    |
| Device seam       | `render/gfx/GfxDevice.ts`, `render/gfx/webgpu/WebGPUDevice.ts`, `render/gfx/webgl2/WebGL2Device.ts`        |
| 2D renderer       | `render/gfx/Gfx2D.ts`, `render/gfx/GpuGfx.ts`, `render/gfx/GpuBatchContext.ts`, `render/gfx/RingStream.ts` |
| Programs          | `render/gfx/programs/*.ts`, `render/gfx/shaders/*.wgsl`                                                    |
| Paths             | `render/gfx/GfxPath.ts`, `render/gfx/pathStroke.ts`, `render/gfx/stencilRecipe.ts`                         |
| Surfaces          | `render/gfx/OffscreenSurfaces.ts`, `render/gfx/offscreenDemand.ts`                                         |
| Text and textures | `render/gfx/rasterizeLabel.ts`, `render/gfx/TextureManager.ts`                                             |
| Path shadows      | `render/gfx/PathShadowCache.ts`                                                                            |
| 3D                | `render/gfx/MeshRenderer.ts`                                                                               |
| AO                | `render/gfx/ao/AmbientOcclusion.ts`                                                                        |
| Post-processing   | `render/postfx/PostProcessPipeline.ts`                                                                     |
| Lottie            | `lottie/render/LottieRenderer.ts`, `nodes/LottieNode.ts`                                                   |
| Benchmarks        | `dev/bench.ts`                                                                                             |
| Shader generation | `crates/shader-gen/src/main.rs` (repository root)                                                          |

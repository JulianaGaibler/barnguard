# Stargazer: performance refactor plan

Draft for discussion, October 2026, revised after reviewing production usage (`CardNode`, the 3D card poses, the JezzBall `BoardController`). Companion to `docs/stargazer-review-brief.md` and `docs/lottie-performance-report.md`. Section references in the form "brief §x" point at the review brief; "RFC §x" points at the cross-architecture optimization RFC.

---

## 0. What the evidence says, and what follows from it

Two things were measured, one was ruled out:

1. **Draw count and per-draw state dominated.** 1500 trivial draws cost 88 ms before the uniform staging fix and 17 ms after. Cost tracked draws, not vertex volume.
2. **JavaScript geometry regeneration is what remains.** \~0.39 ms per small Lottie animation, spent in the union stroker, flattening, fan emission and vertex writers, regenerating geometry that mostly did not change.
3. **Fill rate was not a limit** on the test machine (MSAA 1x and 4x identical). This was an M-series Mac at 2560 × 1207 on WebGL2. It will not stay true at 3840 × 2160 on Iris Xe.

Everything in brief §10 marked *inferred* is real but unmeasured. The plan below orders work so that the two measured costs are attacked first, and so that the work for one is a prerequisite for the other rather than a rival to it.

Two design principles drive the whole plan:

- **A run should break only on things the GPU needs a different pipeline or binding for:** blend mode, stencil recipe, render target, and (rarely) a texture that cannot live in an array. Nothing else. Paint, clip, transform and gradient are data, not state.
- **An unchanged node should cost a GPU-side copy and a few parameter writes, not a tessellation.** Retention has to live *behind* the immediate-mode API, keyed on objects applications already hold (`GfxPath`), so the public API does not have to change.

The answer to brief Q1 is therefore: fewer draws and less JavaScript are the same project. The parameter table that collapses draws (Phase 1) is exactly what makes retained geometry batchable (Phase 3). Do not design them separately.

### What the production examples show

Three application files (`CardNode`, the 3D card poses, the JezzBall `BoardController`) show how the API is used in practice. They shift emphasis in five places:

1. **UI content is shapes, text and small images, not paths.** `CardNode` draws a card face with zero `fillPath` calls: dozens of `fillRoundRect`/`fillCircle`/`strokeRoundRect`, 10–15 `fillText` calls, five or so `drawImage` icon draws, one analytic circle clip, and up to \~200 `fillRect` calls for a 16×16 pixel-art portrait. On this content the run breakers are per-image textures (each icon is its own texture, so each `drawImage` is a texture switch), the per-card `setClip`, and label pages. Phase 1's texture array and clip-as-data matter at least as much for UI as for Lottie, and the icon atlas should be engine-side so applications never pack sprites by hand.
2. **Applications recompute layout inside `draw`.** `CardNode.draw` calls `cardFace`, `fitTextBlock`, `fitRichTextBlock`, `textAdvance` and `textMetrics` every frame, for content that changes only when a setter fires (`setFace`, `setScore`, `setLifted`, `setFaded`, `setSize`). Path-level retention would not catch any of this, because none of it is a `GfxPath`. Retention has to be at the node: a node's content is painted when it changes and replayed otherwise. Since the engine is unreleased, §1 makes that the API rather than an optimization hidden behind it.
3. **Transform tweens are constant and change scale.** Deal-in grows from 0, flips squash `scaleX` to 0.02, travel scales between slots. Retained geometry must be transform-independent (it is: the transform lives in the param record), but scale changes also re-bucket every label on the card against a cache that allows 24 re-rasterizations per frame and 768 labels total. A board of cards thrashes that cache for the duration of every animation. Text needs hysteresis during tweens now and a glyph atlas later.
4. **Missing features are being worked around in application code, at a cost to the renderer.** Cards are single nodes because `transform.alpha` does not cascade; fades are drawn as a colour veil because alpha is per draw rather than per group; the portrait disc is filled inside a clip because two antialiased circles leave a hairline seam; the clip switches from circle to rounded rect mid-flip because the analytic circle clip mishandles non-uniform scale. Each of these is a gap the refactor should close rather than preserve, and the clip one changes Phase 1's clip record.
5. **The 3D card table and the JezzBall board are the other two content shapes.** If 3D cards are `Viewport2DNode`s, each one owns 20 MB of pages, renders every frame and submits separately — the most expensive possible way to show a face that changes only on flip. The JezzBall `GridFieldNode` is a large, mostly static field that changes a few cells at a time; the physics behaviour is one of the few legitimate fixed-step users; wall and burst nodes churn. These argue for shared renderer resources and render-on-change viewports (Phase 4f), partial-update retained geometry for grids (Phase 3), lifecycle-aware arena allocation, and registries for fixed-step work (Phase 6).

---

## 1. Target architecture: a retained scene of recorded pictures

Stargazer is unreleased and has two consumers, so the plan assumes an API change rather than working behind the current one. The change is **not** "every rectangle becomes a node." It is a **retained display list with GPU-resident primitive data**: the renderer keeps primitives, their parameters and the transforms they hang from on the GPU, rebuilds them only when content changes, and per frame does little more than update transforms and re-batch. That is WebRender's shape (§1.4). On top of it sits a paint-on-dirty authoring API in the style of Flutter and Skia pictures: a retained tree of nodes whose per-frame properties (transform, opacity, visibility, clip, blend) are cheap to change, each owning recorded *pictures* that are re-recorded only when their content changes. The drawing vocabulary stays canvas-like; what goes is the assumption that it runs every frame, and that anything is re-uploaded every frame.

### 1.1 Why this shape

| Option | Verdict |
| --- | --- |
| Keep immediate mode, retain behind it (previous draft) | Works, but every node pays a per-frame `draw` by default and the engine has to detect invariance by opt-in versions or hashing. Retention becomes something developers may or may not get. |
| Object per primitive (`RectNode`, `TextNode`… for everything; PixiJS-style) | A card face is \~300 primitives; twenty cards is 6000 nodes, each with object, tree and transform overhead in JS. `CardNode`'s authors already rejected this shape for alpha and tween reasons. |
| Retained display list with GPU-resident primitives (WebRender), authored through paint-on-dirty pictures (Flutter/Skia) | Keeps paint code imperative and dense; separates what changes per frame from what changes rarely; the renderer retains geometry and parameters across frames rather than re-rasterizing pictures like Skia or compositing bitmaps like Core Animation; makes culling, bounds, hit testing, group opacity and raster caching node properties instead of application tricks. **Chosen.** |
| Declarative or reactive widget layer | Not now. The two games are fine imperative, and a widget layer can be built on top later without touching the renderer. |

### 1.2 The model

- **`Node2D`** carries transform, `alpha` (cascading), `visible`, `clip` (a local-space shape or `Path`), `blend`, `compositeGroup` (forces a real offscreen group for opacity, masks and blend modes), `pixelSnap`, and derived `bounds`. Changing any of these never repaints anything; they are param writes at compose time.
- **`paint(canvas)`** runs only when the node called `markNeedsPaint()` or the engine invalidated it (scale bucket crossed while at rest, device scale changed, a resource it uses changed, layout resized it). It records into the node's **`Picture`**: local-space geometry and param records in the arena. Replaying a picture is a param write plus a GPU copy.
- **Retained resources** are what pictures reference: `Path` (verbs and points; tessellation and stroke geometry cached per scale bucket), `TextBlock` (layout, shaping and metrics cached; raster via the label or glyph atlas), `Image`/`Sprite` (atlas-managed, nearest or linear), `Gradient` (ramp handle). Changing a resource dirties the pictures that use it.
- **Leaf nodes** (`RectNode`, `CircleNode`, `ImageNode`, `TextNode`, `PathNode`) are a `Node2D` with a built-in one-primitive picture, for things like a ball, a wall segment or a HUD label, where the whole node is one shape driven by its transform.
- **`Layer` nodes** replace the three fixed render layers. A layer has `cache: 'none' | 'raster'`; a raster-cached layer renders into a texture-array layer only when something in it is dirty and composes as one quad. The static-layer cache, the raster cache for small repeated content, and the 3D card faces are all this one property.
- **Content that changes every frame** (particles, a growing bar, animated Lottie shapes) calls `markNeedsPaint()` every frame. It is the same mechanism, not a second path, and it costs what re-recording that one node costs. Particle systems should write instance data directly rather than repaint.
- **Compose**, each frame: propagate dirty transforms (exists), walk the tree once with a state stack (transform, cascading alpha, clip, blend; this replaces the flat per-layer lists and fixes alpha cascade), cull by picture bounds, emit runs through the stencil scheduler and param table, build the pass list, submit once.

Memory is the cost of retention: every picture lives in the arena. Budgets and eviction are in Phase 3; a node whose picture is evicted simply repaints on its next compose.

### 1.3 What it does to the production code

- **`CardNode`:** `draw` becomes `paint`; the six setters call `markNeedsPaint()`; the `#lastScale` snapping logic, the `#squashed` circle-to-rounded-rect clip swap and the fade veil are deleted (engine-managed scale buckets, local-space clips and cascading alpha replace them). Deal, flip, travel and settle tweens become param writes; a card at rest costs nothing on the CPU. Pixel-snapping the portrait at rest and letting it scale as a whole during a tween is exactly the behaviour the current code works hard to approximate.
- **The 3D card table:** a face is a `Layer` with `cache: 'raster'` rendered to a texture-array layer on flip or score, and the card meshes are one instanced draw (Phases 4f, 5).
- **JezzBall:** `BallNode` is a `CircleNode` following its body. `WallSegmentNode` is a unit rect whose length is `scaleX`/`scaleY`, so `setLength` is a transform change and the node never repaints. `GridFieldNode` is a raster-cached layer that repaints only the cells `revealCells` touched (Phase 3c). `BurstNode` uses the particle system.
- **Lottie:** `LottieNode` compiles the file into a subtree instead of one `draw`: layers and groups become nodes (transform, opacity, mattes and masks through `compositeGroup` and `clip`), shapes become pictures that repaint only when their own keyframes change. Shapes with animated transforms but static geometry, which is most of a typical file, stop costing anything per frame; the stencil scheduler and cached tessellation (Phase 2) handle the rest.

### 1.4 Precedent: what to take from WebRender, and where Stargazer differs

WebRender is the closest existing design, and it has run on GL and ANGLE across exactly the hardware in brief §3 for years. Borrow deliberately:

| WebRender | Stargazer equivalent | What it changes in this plan |
| --- | --- | --- |
| Scene build (on content change) vs frame build (per frame) | Paint vs compose | Already the split in §1.2; frame build must stay O(visible pictures) with no geometry work |
| Spatial tree: primitives reference a spatial node by index, transforms applied in the shader | Transform table referenced from param records | **Changes Phase 1:** a record stores a transform *index*, not a matrix. Moving a card writes one transform entry, not 300 records; a card at rest writes nothing |
| GPU cache: a float data texture of primitive data, updated in dirty blocks | Param table (storage buffer on WebGPU, `RGBA32F` texture on WebGL2) | Validates the WebGL2 choice; dirty-range uploads only |
| Interning: unchanged primitives keep their GPU cache handles across scene builds | Persistent param slots per picture | Already in Phase 3a |
| Clip chains: rect clips folded analytically, complex clips rendered to a mask atlas and sampled | Clip table referenced by index; mask atlas as an alternative to stencil clips | **Changes Phase 1:** nested clips become a chain reference; path clips get a measured choice between stencil depth bits and an R8 mask tile |
| Texture cache: atlas arrays per format, shelf allocation | Texture array (Phase 1.4) | Same design |
| Picture caching: tiles with per-tile invalidation | `Layer.cache = 'raster'` with dirty rects (Phase 3b/3c) | Same design; expect it to matter for static layers, not for the moving board |
| Opaque pass: rects segmented into an opaque interior drawn front-to-back with depth, and alpha-blended edges | Not planned | Reopens the RFC's depth-pass idea in a workable form; take it only if Phase 0 shows fill rate on Iris Xe at 4K |
| Render task graph: offscreen targets allocated into shared textures per pass | Pass list (Phase 4e) | Same shape; precedent that it does not need to be a general DAG |
| Scene building and rendering on their own threads | Worker rendering (Phase 7) | The scene/frame split is what makes the thread boundary cheap |

Where Stargazer is not WebRender, and the design must not pretend otherwise:

- **Vector paths are first-class.** WebRender rasterizes SVG and paths on the CPU and treats them as images. Stargazer's Lottie and vector art need the GPU stencil path with MSAA, so the renderer is a WebRender-style compositor for shapes, text and images **plus** a stencil vector rasterizer (Phase 2) that must batch with it.
- **Per-frame content is normal, not exceptional.** Animated Lottie shapes, particles and growing geometry repaint every frame. The scene-build path has to be fast enough to run partially every frame, which is why pictures are segmented and resources are cached per scale bucket.
- **3D in the same pass.** Meshes draw into the main pass before the display list replays; the pass list has to carry both.
- **No native code.** WebRender's scene builder is Rust on its own thread. Stargazer's is TypeScript, so keeping it O(changed pictures) is a correctness requirement for the frame budget, not an optimization.

### 1.5 The frame after the refactor

```
UPDATE      registries of nodes with update/fixed-step work (no full-tree walks)
            dirty transforms only; has3D is a counter, not a search

PAINT       only nodes marked dirty: paint(canvas) re-records their Picture
            Path / TextBlock / Image resources cached; a changed resource dirties its users
            fillPath/strokePath → geometry cache lookup by (Path, version, scale bucket)
              hit:  GPU-side copy of retained vertices into the frame stream
              miss: tessellate/stroke in local space, retain, then copy

COMPOSE     one tree walk with a state stack: transform, cascading alpha, clip, blend
            cull by picture bounds; transform-table write for nodes that moved; GPU copy per visible picture
            stencil scheduler groups non-overlapping path fills into one fan + one cover
            Layers with cache: 'raster' render to an atlas layer only when dirty → one quad

PASS LIST   built from the recorded runs, in dependency order:
              path-shadow bakes (atlased: 1 raster pass + 2 blur passes total)
              offscreen surfaces (all of them, nested first, into a pooled atlas)
              shadow maps (only dirty layers), AO prepass (half-res)
              one unbroken main pass: 3D then 2D, MSAA resolved in-pass straight into
                the canvas texture (or into the first post target), stencil + depth discarded
              fused post-processing, last pass writes the canvas

REPLAY      one command encoder, one submit (WebGPU)
            redundant-binding checks on every setter (both backends)
```

Expected shape of the numbers after Phases A and 1–3, for the scenes in brief §9: 1500 rectangles → 1 draw; 50 small Lottie animations → under 100 draws when they overlap, a few dozen when they do not, and under 3 ms of JavaScript for the 2D phase. These are targets for the exit criteria, not promises.

---

## 2. Phases

Each phase lists what changes, why, the design, backend notes, risks, and a measurable exit criterion. Phase 0 gates everything. Phase A is the API change and comes first because it is the contract the games are written against; Phase 1 can run alongside it on the renderer side. Phases 2 and 3 build on both. Phases 4–6 are largely independent of each other and can run in parallel with 2–3 once Phase 1 has landed.

### Phase 0 — Measure before moving (gate for everything else)

**Why.** The brief has one machine, one browser, one backend, and no GPU timing. Several phases below are inferred wins. Without GPU timing and per-frame counters, there is no way to know when a phase is done or whether a step regressed Iris Xe while helping M1.

**What to build.**

- **Per-frame counters**, exposed in the debug overlay and in `dev/bench.ts` output: draws, runs, run-break reasons (histogram by cause), render passes, pass splits, queue submits, bytes uploaded per ring, params written, geometry-cache hit rate, retained-geometry bytes, surface count and pixel area, JS time per phase. These are cheap and they turn "inferred" into "measured" for most of brief §10.
- **GPU timing.** Feature-detect and use whatever is available rather than relying on any one: WebGPU `timestamp-query` where the browser exposes it (quantized, but good enough for pass-level attribution); `EXT_disjoint_timer_query_webgl2` where present; and for macOS development, Xcode Instruments → Metal System Trace attached to the browser's GPU helper process, which shows real pass durations, load/store traffic and tile utilization for both WebGL (through ANGLE/Metal) and WebGPU. For shader-level work, running the WGSL through a standalone Dawn build (`dawn.node`) under Xcode's GPU capture is the most reliable way to see Metal-level costs. Verify current browser support when this phase starts; it changes often.
- **Benchmark matrix.** Extend `dev/bench.ts` with deterministic scenes covering: many trivial draws; many small paths (Lottie); few large paths at 4K (fill rate); a mixed 3D + 2D scene; a scene with several offscreen surfaces; a text-heavy UI; a board of `CardNode`-style nodes under deal and flip tweens; a large mostly-static grid with a few cells changing per frame. Run on all three reference devices, Chrome/Firefox/Safari, both backends. Record the baseline before Phase 1.
- **Fix two latent bugs now:** clamp sample count to {1, 4} (WebGPU rejects 2; brief §5.2), and invalidate the combined depth-stencil attachment on WebGL2 (brief §5.3).

**Exit criterion.** A baseline table for every scene × device × browser × backend, with GPU time where obtainable, checked into `docs/`.

---

### Phase A — The retained API (first; in parallel with Phase 1)

**Why first.** It is the contract both games and the Lottie compiler are written against, so every week it is unsettled is a week of code written to the old one. It also pays off before any renderer work lands: a node that is not repainted costs a copy instead of a `draw`, even with today's uniform slices.

**Public API changes** (the model is in §1.2). No compatibility shims; the old paths are deleted.

- `Node2D.draw(gfx)` every frame → `Node2D.paint(canvas)` on demand, with `markNeedsPaint()`.
- `transform.alpha` applied per draw → `alpha` that cascades, plus `compositeGroup` for true group compositing.
- `debugBounds` → `bounds` derived from the picture; an explicit `bounds` is an override only. Culling is on by default.
- Three fixed render layers → `Layer` nodes with `cache`.
- `Gfx2D` → `Canvas`, the recorder: same vocabulary, minus `deviceScale()` and `snapSize()`, which become `pixelSnap` on the node and engine-managed scale buckets.
- Resources: `Path` (rename of `GfxPath`), `TextBlock`, `Image`/`Sprite`, `Gradient`.
- Leaf nodes: `RectNode`, `CircleNode`, `ImageNode`, `TextNode`, `PathNode`.
- `LottieNode` compiles to a subtree.

**Engine work.**

1. The recorder emits local-space geometry; a `Picture` holds it plus its param records. Clips, alpha and blend recorded inside `paint` are baked into the records.
2. Interim compose before Phase 1: transform picture vertices on the CPU into the ring with a tight `Float32Array` loop. Switch to shader-side transforms through the param table when Phase 1 lands; nothing above the recorder changes.
3. One compose walk with a state stack; the flat per-layer lists and the per-node ancestor walks go.
4. Engine-driven invalidation: scale bucket crossed while the node is not tweening (hysteresis during tweens), device scale change, resource change (font or image loaded, `Path` edited), layout size change. A repaint of a node whose picture is still valid for the new bucket is skipped.
5. Repaint counters in the overlay, and a dev-mode staleness checker that periodically repaints a sample of clean nodes and compares record hashes, so a missed `markNeedsPaint()` is a warning in development rather than a stale card in production.
6. Port `CardNode`, the card table, JezzBall and Lottie as described in §1.3.

**Exit criteria.** Both games on the new API with the old path deleted. A resting board of cards executes zero `paint` calls and composes in under 20 µs per card. During a deal or flip, no card repaints. A Lottie file whose shapes have animated transforms over static geometry repaints nothing after its first frame.

---

### Phase 1 — Remove per-draw state: parameter table, paint modes, texture arrays, binding hygiene

Covers brief §13.1 and §13.7. This is the single largest win per unit of effort and a prerequisite for Phases 2 and 3.

**Why.** Today a run breaks on program, blend, texture, lookup texture, clip, clip mask, paint, stencil row and clip depth. Per-run parameters sit in 256-byte-aligned uniform slices (8× upload inflation for clips). On WebGL2 every run costs a `bindBufferRange`, and in Firefox every GL call is an IPC message to the GPU process. Collapsing this is what took 1500 rectangles from 88 ms to 17 ms; this phase takes them to one draw.

**Design.**

1. **`ParamTable`.** A device-level abstraction: a persistent, indexable table of fixed-stride records (64 B: transform index, clip index, paint mode, colour, gradient ramp row, texture layer and UV rect) plus two companion tables it points into, as WebRender's primitives point at spatial and clip nodes. The **transform table** holds one 2×3 matrix per spatial node (a `Node2D` with a picture, or a `Layer`), written only when that node's world matrix changes; the **clip table** holds analytic clip shapes in local space with their own transform index. Each draw record — per instance for instanced programs, per vertex for `coloredTri` — carries a `u32` param index. The vertex shader fetches the record, then its transform and clip (two dependent fetches, cheap in a vertex shader), applies the transform, and passes paint and clip data to the fragment shader as `flat` varyings (8–10 vec4s; well within the GLSL ES 3.00 minimum of 15). Fragment cost is unchanged from today's uniform reads. A moving card writes one transform entry; a card at rest writes nothing.
   - *WebGPU:* a `read-only-storage` buffer. Add storage buffers to `GfxDevice`; it is the one missing binding type and it unblocks Phase 7 as well.
   - *WebGL2:* a `RGBA32F` data texture (4 texels per record), fetched with `texelFetch` in the vertex shader. Vertex texture fetch is guaranteed in WebGL2 and is cheap on all three reference GPUs. A 2048-wide texture with 1024 rows holds 512K records. Update with `texSubImage2D` on dirty row ranges only. The UBO alternative (16 KB pages indexed by a per-vertex id, break on page change) works but caps a run at 256 records; the data texture has no such cap and is the better default.
   - *Tooling:* `shader-gen` needs one addition — on the GLSL target, rewrite `params[i]` storage reads into a `texelFetch` helper. Do this as a WGSL-level preprocessing step keyed on a marker struct so the WGSL stays the single source.
   - The table is **persistent, not a per-frame ring**. Slots are allocated for retained nodes (Phase 3) and for a transient region reused each frame. Dirty-range tracking decides what is uploaded.
2. **Clips become data.** The analytic clip slice (brief §6.6) moves into the clip table. The 256-byte clip ring disappears. Add the scissor fast path for pixel-aligned rectangle clips (scissor is already dynamic per draw). Store each clip as a shape in local space plus a transform index, and evaluate coverage in local space: a circle clip under non-uniform scale then becomes the ellipse it should be, the circle-to-rounded-rect workaround `CardNode` carries for its flip goes away, and a node's clip travels with its retained geometry (Phase 3). Nested clips form a chain: rect and rounded-rect clips are intersected analytically at paint time where their transforms allow, and the remainder is referenced by index. Arbitrary path clips get a measured choice: today's stencil depth bits (free fill, but a run break and a 7-level limit) or an R8 mask tile rasterized once into an atlas and sampled, as WebRender does (one texture fetch, no run break, no depth limit, but no MSAA on the mask edge unless rasterized at 2×). Decide on Iris Xe numbers from Phase 0.
3. **Fewer programs, switched on paint mode.** Merge into two programs sharing one paint/clip module:
   - `quad`: instanced unit quad — SDF circles, rounded rects, analytic shadows, label quads, sprite quads, radial and masked gradients, path-shadow composites, user shader quads if their uniforms fit.
   - `tri`: triangle lists — fills, paths, polygons, stencil fans and covers, outline strokes, offscreen composites. `stroke` can stay separate (its instancing is specialized) or fold into `quad`; measure. Branching on a `flat` paint-mode varying is uniform per primitive, so there is no divergence; the cost is register pressure. Measure the merged fragment shader on Iris Xe at 4K before committing; if it regresses, keep two fragment variants (solid/texture vs gradient) behind the same vertex program.
4. **Texture arrays.** Put the label page, sprite atlas, gradient ramp, resolved offscreen surfaces and small images into one `texture_2d_array` / `sampler2DArray` of 2048² RGBA8 layers; the param record carries the layer. WebGL2 guarantees ≥ 256 layers. Images larger than a layer keep their own binding and break runs (rare, and they are big draws anyway). Use a shelf or guillotine allocator per layer with eviction, and route every `drawImage` of a small image through it automatically so an icon set like `CardNode`'s lands in the array with no application-side packing. This is what finally stops textures breaking runs: a card face today pays a run break for each of its icons. Add a nearest-filtered `drawImage` option (`smoothing: false`) with device-pixel snapping of the destination rect, so pixel art like the card portraits can be one 16×16 texture drawn as one quad instead of up to 200 snapped `fillRect`s with the same uniform-cell look.
5. **Binding and submission hygiene** (independent, do early):
   - Skip redundant `setBindGroup`, `setVertexBuffer`, `bindBufferRange`, `bindVertexArray`; cache the VAO key on the pipeline object instead of building a string per draw.
   - Cache texture views and bind groups (keyed on resource ids) in `WebGPUDevice`.
   - One `queue.submit` per frame including present and post (details in Phase 4).
   - `KHR_parallel_shader_compile` on WebGL2; keep the readiness gate.
   - Pad 4-byte-misaligned writes from a reusable scratch buffer rather than a fresh allocation.
6. **Overlap-aware batching, from WebRender's alpha batch list.** Today a run breaks whenever the *next* draw differs from the current one. WebRender instead searches backwards through recent batches for one with a matching key and merges the primitive into it if its rect does not overlap any primitive in the batches after that one; painter order is preserved because a draw only moves earlier past things it does not touch. Apply the same rule to every run kind, with a bounded lookback (16–32 batches) and a union rect per batch for a fast reject. With the param table collapsing keys to blend, stencil recipe, target and texture page, the fragmentation that remains is interleaving: `lighter` particles over normal shapes, or stencil paths between shapes. Lookback merges the shapes around them into one batch. Phase 2's stencil scheduler is this rule specialized for fan/cover pairs and should be built on the same batch list. Because the display list is retained, a layer's batch assignment can itself be cached and reused while nothing in the layer changed or moved across another primitive's rect; re-batch only dirty layers, which for a static layer means never.

**Run-break rule after this phase:** blend mode, stencil recipe, render target, out-of-array texture — and only when lookback finds no earlier compatible batch.

**Risks.** Fragment shader cost of the merged program on weak GPUs (mitigation above). Texture array layer size forces the sprite atlas to 2048² (more memory per renderer; offset by Phase 4's per-viewport sharing). `shader-gen` work for storage → texelFetch.

**Exit criteria.** 1500 rectangles → 1 draw and ≤ 1 ms JS for the 2D phase. A board of twenty cards with `lighter` particles over it → at most 3 shape batches. Run-break histogram shows zero breaks for paint, clip or texture in the Lottie scene. No visual diffs in the screenshot suite.

---

### Phase 2 — Paths: batched stencil-then-cover, cached tessellation and stroking

Covers brief §13.2 options 1 and 2. Answers brief Q2.

**Recommendation.** Keep stencil-then-cover as the rasterization method for both backends — it is correct for any winding rule, it is the same code on WebGPU and WebGL2, and MSAA gives it antialiasing for free. Fix its two problems — two draws per path and per-frame geometry — rather than replacing it. Analytic coverage and compute rasterization are discussed in Phase 7; neither addresses the measured costs and both fork the backends.

**2a. Stencil scheduler.** Paths whose device-space bounding boxes do not overlap can share one fan draw and one cover draw, because their winding counts occupy disjoint pixels and each cover clears its own box. The scheduler, built on the Phase 1 batch list:

- Keeps a pending batch of path fills with the same stencil recipe (same clip depth) and target.
- On each new path fill: if its bbox intersects any pending bbox, flush (emit one fan run and one cover run), then start a new batch with it. Otherwise append. With the Phase 1 param table, covers in a batch carry different paints and still batch.
- On any **non-path** draw: if its bbox intersects any pending path bbox, flush first (painter order); otherwise it can be emitted before the pending covers. Keep a conservative union bbox for a fast reject and cap batches at \~64 paths so the overlap test stays trivial.
- A path with a convex hull and solid paint keeps its current one-fan fast path, now batched with other `tri` draws.

Expected effect: a small Lottie icon goes from 30–54 draws to a handful; 50 non-overlapping copies share batches across animations.

**2b. Cache tessellation and stroking in local space.** `GfxPath` already has a version and flattens into scale buckets. Extend the cache from "flattened polylines" to "retained GPU geometry":

- **Fills:** flatten in local space at the bucket tolerance, emit the fan (or a triangulation for convex paths) once, and retain. The per-frame device transform moves into the vertex shader via the param record. Re-tessellate only on version or bucket change.
- **Strokes:** stroke in local space too. Lottie specifies stroke width in local space, so this is exactly correct for Lottie; for application strokes under non-uniform scale it matches today's visual result when width is scaled by the bucket. Cache by (version, width, join, cap, bucket). The union stroker's output — the top self-time item — becomes a cache hit.
- Fill the retained union geometry with the nonzero stencil recipe as today; it batches through 2a.

**2c. Lottie-level sharing.** Fifty synchronized copies of one asset have fifty distinct `GfxPath` objects. Share the compiled model per asset, and memoize `evaluate(frame)` results per (asset, frame index) so copies at the same frame share the same `GfxPath` instances. Loops then re-hit the geometry cache; add an LRU bound per asset.

**Backend notes.** Identical on both backends. The retained-geometry storage is specified in Phase 3; Phase 2 can land first with a CPU-side cache (`Float32Array.set` into the ring) and switch to GPU-side copies when Phase 3 lands.

**Risks.** Stencil scheduler correctness under nested path clips (the clip depth bits are part of the recipe, so batches never cross clip scopes; test the save/restore edge cases). Memory for cached stroke geometry on large animated scenes (bounded by Phase 3's arena budget).

**Exit criteria.** 50 Lottie animations: ≤ 100 draws in the overlapping layout, ≤ 4 ms JS for the 2D phase, geometry-cache hit rate ≥ 95% on a loop's second pass. No visual diffs.

---

### Phase 3 — Retained geometry and raster caches

Covers brief §13.3 and §13.4.

**3a. The geometry arena.** Pictures (Phase A) and cached path geometry (Phase 2) live here. Design points the production code forces:

- Param slots are persistent per picture, and vertices store their absolute param index at record time, so a picture's vertex data is fully static. Records point at a transform-table entry, so nothing in the picture is rewritten when the node moves; that one transform entry is what changes.
- Partial repaint for large mostly-static pictures (the JezzBall grid): a picture may be recorded in named segments with a version per segment, so revealing a few cells re-records those cells and copies the rest.
- Records are freed on node destroy. Bursts and wall segments churn constantly, so the free list and slot allocator must be O(1) and fragmentation-tolerant (size classes).

Storage design:

- A **geometry arena**: a few large persistent GPU buffers with a free-list allocator, a byte budget (start at 64 MB, tune per device), and LRU eviction. Cached geometry from Phase 2 lives here.
- **Param slots are persistent per retained node.** Vertices store their *absolute* param index at tessellation time; the slot's contents (transform, paint, clip) are rewritten each frame, the vertices never are. This is what makes the vertex data fully static.
- **Per frame, an unchanged path costs:** one 64-byte param write and one GPU-side copy of its vertex range into the frame stream — `copyBufferToBuffer` on WebGPU, `copyBufferSubData` on WebGL2. No CPU vertex traffic. The frame stream is gathered in painter order, so one run spans many nodes.
- **Measure the copy-command path on WebGL2 in Firefox.** Each `copyBufferSubData` is an IPC message; a thousand per frame may cost more than a CPU `Float32Array.set`. Keep both strategies behind the arena interface and pick per backend from measurements.

**3b. Raster-cached layers.** `Layer.cache = 'raster'` (Phase A) is the API; this is its implementation. When a cached layer is dirty, or when a small subtree is repeated (fifty synchronized Lottie copies share a content hash), rasterize it once into a texture-array layer and draw it as one quad.

- Candidates: Lottie nodes under \~256² device pixels, static UI panels, any node that opts in. Key by (content hash, scale bucket). For Lottie, content hash = (asset, frame index); fifty synchronized copies then cost one rasterization plus one instanced draw of fifty quads.
- Rasterize at the device scale bucket in its own MSAA pass (pooled, resolved into the array layer). Rotation and sub-bucket scale are applied to the quad; bilinear resampling is acceptable at these sizes.
- Budget: a few 2048² layers at 4K; LRU eviction; a per-frame rasterization budget like the label cache's.
- Invalidate on any content change; fall back to the vector path when the budget is exhausted.

**3c. Dirty-rectangle updates for cached layers.** A cached layer whose content changes in a small region (the JezzBall grid revealing a few cells) re-renders only the dirty rectangles into its texture under a scissor instead of the whole layer. Only worth it for large cached layers with a low dirty rate; do it after 3b if profiles show whole-layer re-renders costing fill rate.

**Risks.** Arena fragmentation under churn (mitigate with size classes). Raster cache hurting quality under heavy scale changes (bucket hysteresis). Memory at 4K (hard budgets everywhere, with telemetry from Phase 0).

**Exit criteria.** 50 synchronized Lottie animations: 1 rasterization per changed frame and ≤ 2 ms total JS. A board of resting `CardNode`s: zero CPU vertex traffic and under 20 µs of compose per card; mid-animation, no card repaints. Steady-state allocations under the 1 MB/frame budget; retained-geometry bytes visible in the overlay and bounded.

---

### Phase 4 — Pass structure for tile-based GPUs

Covers brief §13.5, §11 and the present path. Answers brief Q4, Q5, Q6, Q9.

**4a. Surfaces render before the main pass, always.** Replay already knows every surface before the first draw. Reorder: all surface passes first (nested surfaces before their parents, in dependency order), then one unbroken main pass. Consequences: the main pass never stores multisampled colour or stencil, `addOffscreenDemand` goes away, and the 130 MB reload per split at 4K/4x disappears. Pack small surfaces into a pooled atlas target so N surfaces cost one pass, and composite them from the array layer with no texture switch. The one thing this forbids is a surface that reads the backdrop; Stargazer's blend modes composite rather than read, so nothing is lost.

Once surfaces are cheap, give nodes real group opacity: cascade alpha down the walker's stack (Phase 6) for the common case, and route a subtree through a surface when a node asks for group compositing (`Node2D.groupAlpha`). Today applications draw a whole card in one node and fake fades with a colour veil because alpha neither cascades nor applies to a node's output as a group; that constraint shapes how applications are written and should go.

**4b. Remove the present blit.**

- *WebGPU:* resolve the last pass directly into `context.getCurrentTexture()`. Configure the canvas with the main target's format (or add it to `viewFormats`) so the resolve is legal. With post-processing, the last effect writes the canvas texture. One encoder, one submit.
- *WebGL2:* resolve straight into the default framebuffer (`DRAW_FRAMEBUFFER = null` in `blitFramebuffer`) instead of resolving to a texture and blitting again — one blit instead of two. Also test creating the context with `antialias: true, stencil: true` and rendering the no-surface, no-post case directly into the default framebuffer; this hands the resolve to the browser, which on macOS can fold it into the pass. The cost is losing runtime MSAA switching; the measurement decides.

**4c. Load/store discipline everywhere.** `depthStoreOp: 'discard'` on the main pass (nothing reads it; AO uses its own prepass). `storeOp: 'discard'` on every multisampled attachment that is resolved in-pass. `invalidateFramebuffer` for `DEPTH_STENCIL_ATTACHMENT` on WebGL2. Shadow and AO targets store only what the next pass reads.

**4d. Fewer small passes.** Path-shadow bakes: raster all of a frame's bakes into one atlas page, then two blur passes total, with persistent scratch buffers (three passes per frame instead of three per bake). Post-processing: fuse vignette, chromatic aberration and grain into one pass; keep the blurs separate; last pass writes the canvas.

**4e. A pass list, not a frame graph.** At Stargazer's scale a fixed phase order plus a declarative pass list built per frame — each entry naming attachments, load/store, resolve target and reads — is enough. It gives one place to derive discard, reuse pooled targets, apply transient attachments if they become available, and emit one submit. Grow it into a real graph only if the pass set stops being enumerable.

**4f. Shared renderer resources and render-on-change viewports.** Each `Viewport2DNode` owns 20 MB of pages (brief §7.5), renders every frame and submits separately. A 3D card table with one viewport per card is the worst case for this. Share the texture array, param table and label cache across all `GpuGfx` instances on one device; a viewport keeps only its streams. Render a viewport only when its scene's content changed (node-level versions from Phase 3 roll up to the tree), into a layer of a shared texture array so the meshes showing them can be instanced with a layer index (Phase 5). A face that changes only on flip or scoring then costs nothing between those events.

**Risks.** Format matching for direct canvas resolve across browsers (sRGB vs linear); surface-pool peak memory when many surfaces are live at once (size classes and a budget that falls back to sequential pooling).

**Exit criteria.** Pass count and submit count visible in the overlay; the surface scene shows 0 pass splits and 1 submit; Metal System Trace on M1 shows no load of the MSAA target in any frame; present cost measurably removed at 4K.

---

### Phase 5 — 3D and effects hygiene

Lower priority if content is mostly 2D, but each item is small and the per-frame bind-group churn hurts every frame that has 3D.

- **Bind groups and views cached** per (material, texture set); object uniforms staged per frame like the 2D rings — or, better, in the Phase 1 param table indexed by instance.
- **Frustum culling** and **instancing** by (mesh, material); opaque sorted front-to-back then by pipeline and material (RFC §3's sort order is right for this); transparent back-to-front as today. Many identical quads with different textures — the card table — become one instanced draw once their faces live in a texture array (Phase 4f).
- **Shadow maps only when dirty:** per-light dirty flags from caster and light transforms; static scenes stop re-rendering shadows; a per-frame layer budget round-robins when many are dirty.
- **AO at half resolution** with a bilateral upsample, and a temporal option later. Keep the compute path on WebGPU; it is the one place compute already pays for itself.
- **Interleave vertex attributes** per mesh at load (one buffer, one `setVertexBuffer`).
- **`has3D` as a maintained counter** on attach/detach, not a per-frame DFS.

**Exit criteria.** Zero bind-group creations per frame in a static 3D scene; zero shadow passes in a static scene; AO cost measured at half res on Iris Xe.

---

### Phase 6 — Scene and CPU hygiene (interleave with Phases 2–4)

- Registries of nodes that have `onUpdate`, `onFixedStep` or behaviours, maintained on attach/detach, replacing the full walks (two extra per frame at 120 Hz fixed step). In the production code the fixed-step users are a handful of behaviours (`PhysicsWorldBehavior`, `BoardTickBehavior`), not the tree; the walk is almost entirely wasted.
- Bounds come from pictures (Phase A); `debugBounds` is gone and an explicit `bounds` is an override only.
- The compose walk from Phase A carries visibility, alpha and clip on a stack; anything left of the per-node ancestor walks and flat per-layer lists is deleted here.
- `fillText` key building: add a retained `Label` handle (`gfx.label(text, font)` returns a cached object; `fillLabel(handle, x, y)` draws it) so the hot path builds no strings. Keep `fillText` as the convenience wrapper.
- Text under scale animation: hold a label's raster at its resting bucket while the owning node is tweening (the engine knows which tweens are live) and let the quad scale, re-rasterizing once at rest. Raise, and share across renderers, the 768-label and 24-per-frame bounds, which one board of cards approaches on its own. Longer term a glyph atlas (MSDF for the UI font) removes the bucket problem and takes text out of the Canvas2D rasterizer; treat it as Phase 7, gated on Phase 0's label-cache churn counters.
- `TextBlock` (Phase A) owns layout: `fitTextBlock`, `fitRichTextBlock` and metrics run when the block's text, fonts or box change, never when it is painted or composed.
- Replace `DOMMatrix` with a 2×3 `Float32Array` helper; pool temporaries; hold the 1 MB/frame allocation budget with Phase 0's counters.

---

### Phase 7 — Adaptive quality, WebGPU-forward features, off-main-thread (ongoing)

**Adaptive quality** (brief §13.8) is the honest answer to the 4K/4x/Iris Xe goal. A 4K 4x colour target is 133 MB; even resolved in-pass, an IMR GPU reads it once and writes the 33 MB resolve, several milliseconds of bandwidth on an integrated part. The controller: measure frame time (GPU time where available, else total), apply hysteresis, and step through tiers — render scale (1.0 → 0.75 → 0.5), MSAA (4 → 1), shadow resolution and PCF taps, AO preset, path-shadow and raster-cache budgets. Expose the chosen tier in telemetry so the matrix from Phase 0 can be re-run per tier.

**Analytic antialiasing** (brief §13.2 option 3) becomes useful as the MSAA-off tier: shapes, strokes and text already have it; general paths do not. Rather than curve rendering in the fragment shader, consider a cheaper step first — rendering paths at 1x with a 4x supersampled stencil pass for coverage is not available in WebGPU (no 2x), so the realistic options are a half-resolution-with-upsample tier for paths or a distance-field tier for simple shapes. Decide after Phase 0 shows how MSAA actually costs on Iris Xe.

**WebGPU as the primary design, WebGL2 as a complete fallback** (brief Q10). Keep one 2D pipeline — param table, overlap-aware batching, stencil paths, retained arena — shared by both backends, because its two measured costs are backend-independent. Gate WebGPU-only extras behind feature flags: compute AO, timestamps, storage-buffer params.

**Compute on WebGPU, in the order it pays.** One rule for every item: the CPU version is the WebGL2 fallback and stays the shared, tested code; compute replaces it only where the CPU version is a measured cost.

1. **Particles.** Simulate in a compute pass that writes the instance buffer directly; no readback, no CPU per particle. `BurstNode` and the sprite system. Small, isolated, and the natural first compute feature.
2. **Geometry for per-frame-animated paths.** Flatten curves, emit fans and expand strokes in compute from control points that Lottie's `evaluate` writes into a buffer, with vertex counts produced on the GPU and consumed by `drawIndexedIndirect` (cover bounds via atomic min/max, so the CPU never learns the counts). This targets exactly the measured top self-time — the union stroker, flattening and fan emission — for the one class of paths retention cannot help: those whose keyframes change every frame. Stroke expansion in compute has recent, published designs from Linebender's Vello work to draw on. Static paths keep the cached CPU tessellator on both backends, so WebGL2 loses speed on animated paths, not features.
3. **GPU-driven compose for very large scenes.** A compute pass reads the visible-picture list, culls against the transform table and picture bounds, and gathers retained vertices into the frame stream with indirect draw arguments, replacing N `copyBufferToBuffer` commands with one dispatch. Worth it past several thousand pictures; the two current games are far below that, so this waits for a product that needs it.
4. **Compute blurs** with workgroup memory for path-shadow bakes and post-processing. Modest: fragment separable blur is already bandwidth-cheap on tile-based GPUs.
5. **A full compute rasterizer** (Vello-style, or the sparse-strip hybrid that keeps coverage on the CPU and compositing on the GPU and has been shown running on WebGL2) only when path counts outgrow Phases 2–3. It would replace the stencil path rather than batch with it, so it is a different renderer, not an extension, and should be decided as one.

Not worth compute: text (Canvas2D raster into the atlas is fine until a glyph atlas is justified on its own), culling at current scene sizes, and anything on the opaque UI path, where the win is in the batch list, not the shader.

**Rendering from a worker** (brief §13.9) follows naturally once the run list is the unit of work: the recorded runs plus param writes are already a serializable command stream. Worth doing for input latency in Firefox, where the main thread currently blocks on the GPU process at present time; it does not reduce the work, it moves it.

---

## 3. The RFC: what to adopt and what does not apply

The RFC is written for a sprite-and-mesh engine. Stargazer is mostly antialiased vector content, which changes several of its conclusions.

| RFC item | Verdict for Stargazer |
| --- | --- |
| Explicit `loadOp`/`storeOp`, `depthStoreOp: 'discard'`, `invalidateFramebuffer` as the WebGL2 proxy | **Adopt fully** — Phase 4c, including the combined depth-stencil attachment the engine currently never invalidates. |
| Design to a 16 KB UBO minimum; prefer instanced attributes and `sampler2DArray` on WebGL2 | **Adopt** — Phase 1 uses instance attributes where programs are instanced, a data texture for per-vertex params, and texture arrays for pages. |
| Bindless storage buffer of per-entity records, indexed by instance | **Adopt the idea, resize the record** — 64 B records indexed per vertex or instance; the "128 B = two cache lines" argument is a CPU heuristic with no bearing on GPU fetch. |
| Opaque front-to-back, then pipeline, then texture; transparent back-to-front | **Adopt for 3D** — Phase 5. For 2D, painter order is a correctness constraint and most content is blended; sorting does not apply. |
| 2.5D depth pre-pass, tessellate sprites into tight meshes, no `discard` | **Mostly does not apply as written.** Stargazer does not use `discard`; paths are edge-antialiased and blended. The workable form of the idea is WebRender's opaque pass: segment large rects into an opaque interior drawn front-to-back with depth and alpha-blended edges (§1.4). Card stock is exactly such a rect. Take it only if Phase 0 shows fill rate from overdraw on Iris Xe at 4K. The "no `discard`" rule is worth enforcing in the uber-shader. |
| Compute tile binning for clustered lighting, CPU grid → data texture fallback | **Not needed** — up to 8 lights, forward shaded. The data-texture technique itself is what Phase 1 uses for params on WebGL2. |
| "Hardware HSR negates overdraw on TBDR" | **Only for opaque geometry.** Blended 2D bypasses HSR; overdraw cost on TBDR is fragment shading inside tile memory, which is cheap in bandwidth but not free in ALU. |

---

## 4. Answers to the ten questions

1. **Draws or JavaScript first?** Together, and the API first. Phase A removes per-frame `draw` as the default; Phase 1's param table is what lets the resulting pictures batch into few draws; Phases 2–3 make them cheap to store and replay. Each on its own leaves most of the win on the table.
2. **Path rendering approach.** Batched stencil-then-cover with cached local-space tessellation and stroking, on both backends. Analytic coverage as a later low-quality tier for simple shapes; compute rasterization only if WebGPU becomes the sole primary and path counts outgrow batching.
3. **Replacement for dynamic-offset uniforms on WebGL2.** Instance attributes for instanced programs (no indirection); a `RGBA32F` data texture fetched in the vertex shader for `tri`. Size is not the constraint — hundreds of KB per frame via `texSubImage2D` on dirty rows is fine on Iris Xe; what hurts is fragment-shader fetches, so fetch in the vertex shader and pass flat varyings. A 16 KB UBO page works if you accept a 256-record run cap.
4. **Present blit at 4K on Apple silicon.** Roughly 33 MB read + 33 MB write plus a pass; on the order of 0.5–1 ms of bandwidth at UMA rates, not fatal but free to remove. WebGPU: resolve into `getCurrentTexture()` with matching format. WebGL2: `blitFramebuffer` with the default framebuffer as the draw target, or an antialiased default framebuffer for the simple case.
5. **Pass splits for surfaces.** Not acceptable even when rare, because a frame that *might* use surfaces already stores MSAA colour and stencil. Always render surfaces before the main pass; the recording already contains everything needed.
6. **Transient attachments.** Not reliably exposed in WebGPU across browsers; treat any transient usage flag as an optional feature. The bandwidth win already comes from `storeOp: 'discard'` on an in-pass-resolved MSAA target; what you cannot control is whether the implementation also skips allocating backing memory.
7. **MSAA on weak GPUs at 4K.** Keep 4x as the default tier because it is nearly free on TBDR and the only general-path antialiasing you have. Add a 1x tier driven by the adaptive controller, using existing analytic AA for shapes, strokes and text, and accept aliased or half-res general paths there until an analytic path tier exists.
8. **GPU timing on macOS.** Instruments → Metal System Trace on the browser GPU helper process (works for both APIs); WebGPU `timestamp-query` and `EXT_disjoint_timer_query_webgl2` where available; `dawn.node` under Xcode GPU capture for shader-level analysis of the same WGSL.
9. **Frame graph.** A declarative per-frame pass list with derived load/store and a single submit is enough; a general DAG is not justified by the pass set you have. WebRender's render task graph is the same shape at a larger scale.
10. **One engine or WebGPU-primary.** One shared 2D pipeline (the two measured costs are backend-independent), WebGPU-primary for optional features behind flags, WebGL2 a complete fallback for the core and a reduced tier for extras.

---

## 5. Sequencing, sizing and success metrics

Sizes assume one to two engineers already familiar with the code. They are estimates for sequencing, not commitments.

| Phase | Depends on | Size | Primary metric |
| --- | --- | --- | --- |
| 0 Instrumentation | — | 1–2 wk | Baseline matrix exists |
| A Retained API: nodes, pictures, layers, resources; port both games and Lottie | 0 | 3–5 wk | Resting card board → 0 `paint` calls |
| 1 Param table, paint modes, texture arrays, hygiene | 0 (parallel with A) | 3–4 wk | 1500 rects → 1 draw |
| 2 Stencil scheduler, cached tessellation/stroke | 1 | 3–4 wk | 50 Lottie → ≤ 100 draws, ≤ 4 ms JS |
| 3 Arena, raster-cached layers, dirty rects | A, 1 (path geometry also 2) | 3–5 wk | Resting card board → 0 CPU vertex traffic; 50 synced Lottie → ≤ 2 ms JS |
| 4 Surfaces-first, direct present, discard, pass list | 1 | 2–3 wk | 0 pass splits, 1 submit, no MSAA loads |
| 5 3D hygiene | 1 | 2–3 wk | 0 bind groups/frame static scene |
| 6 Remaining scene/CPU hygiene | A | 1 wk | Allocation budget held |
| 7 Adaptive quality, WebGPU extras, worker | 0–4 | ongoing | 60 fps held per device via tiers |

Phases 0–4 including A are roughly one engineer-quarter plus a few weeks and deliver the API, the bulk of the measured wins and the TBDR fixes. Phase A and Phase 1 should run in parallel on different people: A is scene and API work, 1 is renderer work, and they meet when pictures start composing through the param table. Porting the two games is part of A, not an afterthought; it is how the API gets validated. Re-run the Phase 0 matrix at the end of every phase; a phase is not done until the matrix shows no regression on any reference device.

**What not to do yet:** a compute rasterizer; a general frame graph; a depth pre-pass for 2D; curve-in-fragment-shader antialiasing; wasm for tessellation (measure the TypeScript tessellator first — the cache makes it cold code); an object-per-primitive scene graph; a declarative widget layer on top of the retained tree (it can come later without touching the renderer).

---

## 6. Risks and open items

- **The stated goal may not be reachable without tiers.** 60 fps at 3840 × 2160 with 4x MSAA on Iris Xe is bandwidth-bound regardless of draw count. Adaptive quality is part of the goal, not a fallback for failing it.
- **Invalidation discipline.** Retained mode moves a class of bugs from "slow" to "stale": a setter that forgets `markNeedsPaint()` shows old content. Mitigations: setters generated from a small helper, the dev-mode staleness checker in Phase A, and leaf nodes and resources that invalidate themselves so most application code never calls it by hand.
- **Repaint storms.** Resize, font load and device-scale change dirty everything at once. Repaint visible nodes in the same frame and accept one long frame; spread offscreen and cached-layer repaints across frames under a budget; while a repaint is pending, compose the old picture under the new transform rather than drop the node.
- **Firefox WebGL IPC.** Every GL call is a message. Phases 1 and 4 cut calls by one to two orders of magnitude, which is the right fix; but per-node copy commands in Phase 3 may need to be CPU `set` on this backend. Measure.
- **Visual parity.** Local-space stroking and scale-bucket caching can shift edge placement by sub-pixel amounts versus today's device-space regeneration. Extend the screenshot suite with tolerance thresholds before Phase 2.
- **Memory at 4K.** Texture arrays, retained arenas, raster caches and surface pools all grow with resolution. Every one has a hard budget and a counter from Phase 0; share them across viewports (Phase 4f).
- **Browser feature drift.** Timestamp queries, transient attachments, multi-draw and storage buffer limits all change. Feature-detect, never assume, and keep the shared 2D pipeline free of any of them.
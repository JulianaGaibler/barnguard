# Debug tooling

Dev-only debug HUD, debug camera, frame-time histogram, node outlines, coordinate grid. Gated by a URL query param, nothing debug-related is constructed in production.

## Turning it on

- `?debug=1`. `DebugController` is constructed, hotkeys are bound, HUD is hidden. Press `Y` to open the HUD.
- `?debug=hud`. Same as above with the HUD visible from boot.
- `?debug=perf`. Same as `hud` plus `engine.perfMarks = true`, which emits `performance.mark`/`measure` on every per-node draw. Inspect in Firefox DevTools' User Timing lane.

Anything else (or no `?debug` param at all) leaves `host.debug === null` and doesn't attach a single keyboard listener. The whole debug object graph is absent. `?debug=hud` combines with any demo query, `?demo=camera&debug=hud` is a common one.

## Hotkeys

| Key       | Action                                                                       |
| --------- | ---------------------------------------------------------------------------- |
| `Y`       | Toggle HUD                                                                   |
| `C`       | Toggle debug camera (swaps in for the game camera)                           |
| `O`       | Toggle per-node outlines and pivot crosses                                   |
| `X`       | Toggle world-coordinate grid + axis labels                                   |
| `G`       | Toggle "follow game camera", debug camera mirrors the game camera each frame |
| `R`       | Snap the debug camera back to the game camera's current viewport             |
| `WASD`    | Pan the debug camera (only active when `C` is on)                            |
| `Q` / `E` | Zoom the debug camera out / in                                               |

Hotkeys are attached to `window`. Typing in an `<input>`, `<textarea>`, `<select>`, or `contenteditable` element is ignored, the controller checks `document.activeElement` before consuming the key.

## Stage selector

When one or more secondary stages are attached (see [`stages.md`](./stages.md)), a chip strip appears at the top of the HUD:

```
Stage  [ Primary ]  [ Loss Card ]
```

Tap a chip to point the HUD at that stage. **Stage-scoped** sections and toggles retarget:

- Coordinates (canvas size + DPR are stage-specific)
- Camera (viewport rect, screen-px-per-world)
- Scene (node counts, alive particles, static bakes)
- Scene tree (walks that stage's `scene.root`)
- Camera pad (WASD / Q / E and the `[C]` debug camera control the selected stage)
- Outlines / Grid / Debug camera / Game-camera pip overlays draw on the selected stage

**Primary-only** sections stay pointed at the primary regardless:

- Performance (single rAF loop, one wall-clock frame time)
- Pause (a single engine-wide flag)
- Pointers (input attaches only to the primary canvas; the section shows "Primary stage only" when a secondary is selected)
- Pointer overlay toggle (disabled, dimmed, when a secondary is selected)

When a secondary is selected and gets detached (Svelte destroys the loss card, or the game calls `engine.detachStage(stage)`), the HUD auto-reverts to Primary. The chip disappears from the strip and the sections re-read from the primary within one RAF poll.

Stage labels come from `StageOptions.name` (e.g., `name: 'Loss Card'`); attach without a name and the strip labels it `Stage 1`, `Stage 2`, etc.

## HUD sections

Every section is collapsible; open state persists via the DOM `<details>` element for as long as the page is up. The panel is draggable, grab the title bar; position persists in `localStorage` keyed by the panel title.

### Performance

Frame-time p50/p95/p99/max over the last 5 seconds plus sample count. p95 turns orange when it crosses 16.7 ms (60 fps threshold) and red at 33 ms (30 fps). FPS is `1 / p50` and follows the same coloring.

Note: the recorded value is CPU work time (`engine.lastFrameWorkSec`), not the vsync-locked rAF interval. So a well-under-budget frame reads as its actual work time (e.g. 2 ms), not the flat 16.67 ms of the display refresh.

`FrameStats` is a `Float32Array(300)` ring buffer. `push(dt)` is O(1). `percentiles()` sorts a scratch subarray on demand and takes ~5 μs at 300 samples.

### GPU

Only visible under the WebGL2 backend. Combines settings and diagnostics.

**Controls (top).**

- **Render mode** dropdown. Diagnostic overlays that degrade the image on purpose. Modes: `normal`, `polygons`, `overdraw`, `batch-color`, `clip-mask`. Full when-to-use guidance lives on `DebugRenderMode` in `src/stargazer/render/gfx/GpuGfx.ts`.
- **MSAA** dropdown. Live-swaps the offscreen FBO between `off`, `2×`, `4×`, `8×`. Clamped to the driver's `MAX_SAMPLES`.
- **Perf marks toggle**. Same effect as `?debug=perf`, at runtime.
- **Reload as canvas2d / gpu**. Reloads the page with the corresponding `?renderer=` flag.

**Stats (below).**
Per-frame counters: draw calls, program switches, texture binds, blend switches, SDF instance count, stroke instance count, effective MSAA sample count, and buffer-overflow warnings. Overflow turns red if it fires: bump the corresponding stream's byte size in `GpuGfx.ts`.

Under Canvas 2D the section collapses to a single "Backend: Canvas 2D" row.

### Coordinates

Live cursor position in CSS pixels and world coords, canvas CSS + device dimensions, DPR. The pointer readout is separate from the InputSystem, it comes from a plain `pointermove` listener on the canvas that DebugController installs when it's constructed. It works even for hover (no button pressed), which the real InputSystem doesn't track.

### Pointers

For each currently-down pointer: id, kind (`touch` / `mouse` / `pen`), screen coord, world coord, captured node id (if any). Header shows the total count. Also shows touch slop in both CSS px and world units.

Empty state ("No active pointers") when nothing is down. This is what the plan verified for the multi-touch bezel and camera-drift tests.

### Camera

Which camera is active (`game` or `debug`), the follow flag, the viewport rect (x/y/width/height), and the current screen-px-per-world-unit scale.

### Scene

Node counts split by render layer (static / above-static / dynamic / total), alive particle count summed across every `ParticleEmitterNode`, and the two static-bake counters:

- **Static bakes/s**, sliding-window rate of static-layer re-bakes. In steady state this is 0. A `camera.animateTo` settle bakes once. A `renderLayer` promote → tween → demote pulse bakes twice. Turns orange if it exceeds 5/s, usually a sign that you're mutating a static node without promoting first.
- **Static bakes total**, lifetime counter. Useful for verifying counts exactly (e.g., "did the pulse bake exactly 2 times?").

### Shortcuts

The hotkey list, with a dot next to each toggle that turns green when active.

## Debug camera

When you press `C`:

1. The debug camera snapshots the game camera's current viewport.
2. `engine.activeCamera` starts returning the debug camera; the renderer swaps its transform baseline.
3. `InputSystem` uses the debug camera for world-coord conversion, so pointers still land on the right world points.

`WASD` / `Q` / `E` mutate the debug camera's viewport at rates proportional to its size (so pan feels the same at any zoom). `R` snaps back to `engine.camera.viewport`, one immediate refresh, no tween. `G` puts the debug camera in follow mode: each frame it mirrors the game camera. Useful for watching a `Camera.animateTo` tween from a fixed vantage point (turn off follow after the tween settles if you want to move independently).

The debug camera's step runs in `engine.onBeforeFrame(...)`, ahead of `input.beforeFrame()`, so pointer world coords reproject against the freshly-panned debug camera in the same frame, no one-frame lag while dragging under a moving debug camera.

## Per-node outlines

With `O` on, the debug overlay walks the scene and draws each `visible` node's `debugBounds` (axis-aligned in the node's local coords, transformed through its world matrix to screen). A small yellow cross marks each node's transform origin.

Concrete primitives set `debugBounds` where they can:

- `ShapeNode`, from its geometry (circle → 2r square around origin; rect → the rect itself).
- `Path2DNode`, pass an explicit `debugBounds` in the options; `parseSvgPaths` gives you the exact per-path AABB.
- `PolylineNode`, expands automatically as points are pushed.
- `SceneNode` base and `GroupNode`, null unless the caller sets it.

Nodes with a null `debugBounds` still get the pivot cross, just no rectangle. Opt out per-node with `node.debugVisible = false`, used automatically for particle emitter internals, which would otherwise clutter the overlay.

## Coordinate grid

With `X` on, the overlay draws a grid in world coords. The step adapts to the visible range (`1 / 2 / 5 × 10ⁿ` so ~10 major lines fit across the viewport). Minor lines at 1/5 the major step. World-axes (x=0, y=0) are picked out in yellow. Numeric labels sit along the top and left edges, clamped so they follow when the origin scrolls off screen.

The grid uses the active camera, so it follows the debug camera when that's on.

## Zero-overhead-when-off

The contract is a hard one:

- Without `?debug` in the URL, `EngineHost` doesn't construct `DebugController`. `host.debug === null` for the whole session.
- The debug drawOverlay pass is guarded by `if (this.debug === null) return` at the top of the render step. The JIT inlines this into a single field-null check.
- No keyboard listeners are attached to `window`.
- `FrameStats` ring buffer allocations happen lazily on first HUD show; `SceneNode.debugBounds` recomputation is only requested from the debug overlay pass.
- `DebugHud.svelte` is behind a `{#if host?.debug}` gate in `GameScreen.svelte` / `DemoRouter.svelte`, the component never mounts.

The debug CSS (`debug/ui/debug-ui.sass`) ships in the shared `EngineHost` chunk because it's a side-effect import from `DebugController.ts`. Kilobytes of dead-branch code, no runtime cost.

Verify with a `?debug=perf-check` test scene (empty scene, 10 seconds of rAF): p95 frame time with `?debug` absent vs `?debug=1&hud hidden` should stay within noise (< 1% delta) on the target hardware.

## The `debug/ui/` component library

Reusable Svelte components composed into `debug/DebugHud.svelte`. Import from `@src/stargazer/debug/ui`.

- `DebugPanel.svelte`. Draggable outer shell. Title bar, close button, `side: 'left' | 'right'`, localStorage-persisted position, slim dark scrollbar.
- `DebugSection.svelte`. Collapsible `<details>` with optional summary snippet.
- `DebugRow.svelte`. Labelled key/value row. `tone` is `'default' | 'warning' | 'error' | 'accent'`.
- `DebugSelect.svelte`. Stacked dropdown. Generic over `string | number` value; label above, full-width `<select>` below (so long option strings can't blow out the panel width).
- `ToggleButton.svelte`. On/off pill with optional keyboard `hint` chip.
- `HoldButton.svelte`. Press-and-hold button for the camera pad. Uses `setPointerCapture` plus `pointerleave` + `window.blur` + `visibilitychange` safety nets so a stuck press can't leak across a system swipe or backgrounded tab.
- `StageSelector.svelte`. Chip strip driving the primary/secondary stage switcher.
- `ProgressBar.svelte`. 0-100% bar with configurable color and height.
- `FrameGraph.svelte`. Frame-time histogram fed by `FrameStats`.
- `DebugTree.svelte`. Expandable tree with a `renderContent` snippet slot. The whole row is clickable, not just the chevron.

The shared SASS in `debug-ui.sass` uses plain global selectors (no Svelte `:global(...)` wrappers). It's loaded once as a side-effect import from `DebugController.ts`. Style is dark background, monospace, blue/purple accents. `font-variant-numeric: slashed-zero` on the panel so `<kbd>` chips can't be misread (letter `O` vs digit `0`).

A shared `.debug-controls` class stacks interactive controls with a consistent 4 px gap. Add `.with-divider` to draw a faint hairline below (used in the GPU section to separate controls from stats).

Reuse the same primitives if you build another HUD panel elsewhere in the app.

## RAF polling, not Svelte stores

The HUD reads engine state via `requestAnimationFrame`, not by binding Svelte stores to `frame` or `pointerMove`. Cheap reads (FPS, camera position, active pointer count) tick every frame; expensive reads (scene-tree walk, per-node debug bounds) run only when their section is open. Every polled value is a scalar or a small object, no arrays get diffed, nothing re-renders unless a scalar changes.

If you add a section that reads a lot of state, keep the same pattern: read directly from `debug.engine` in the poll loop, gate expensive reads behind the section's `open` state.

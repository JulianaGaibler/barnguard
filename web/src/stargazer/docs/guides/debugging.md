---
title: Debugging
group: Features
order: 10
---

# Debugging

Every engine host has a {@link DebugController} at `host.debug`. It owns the debug HUD state, the hotkeys, a free 2D and 3D debug camera, on-canvas overlays, and the per-frame stats. The host always builds it, so the hotkeys work in every build.

The HUD itself is the `DebugHud` Svelte component: a hub window plus panels for the scene, rendering, quality, input, and physics. Mount it next to the canvas and pass it `host.debug`. The controller decides whether it's visible.

## Basic usage

Add `?debug=hud` to the page URL to open the HUD on boot, or press `Y` at any time. In code, pass `debug: 'hud'` to {@link createEngineHost}, or toggle it at runtime:

```ts
host.debug.setHudVisible(true)
host.debug.toggleHud()
```

The `debug` option takes `'hidden'`, `'hud'`, or `'perf'`. When you leave it out, the host reads the `?debug` URL flag. Any value other than `hud` or `perf` starts with the HUD hidden.

### Hotkeys

The controller listens for keys on the window. It ignores keys typed into text fields. The table lists the keys.

| Key | Effect                                                         |
| --- | -------------------------------------------------------------- |
| `Y` | Show or hide the HUD                                           |
| `C` | Toggle the 2D pan and zoom debug camera                        |
| `V` | Toggle the 3D fly camera                                       |
| `G` | Make the 2D debug camera follow the game camera                |
| `R` | Reset the active debug camera to the game camera's view        |
| `O` | Outline node bounds                                            |
| `L` | Outline layout boxes                                           |
| `X` | Show the coordinate grid                                       |
| `T` | Show the pointer overlay                                       |
| `P` | Freeze updates, tweens, and the fixed step, but keep rendering |

### Debug cameras

`C` and `V` swap in a debug camera without changing the game camera. With the 2D debug camera, the game camera's viewport shows as a dashed rectangle. Input still goes through the camera on screen, so you can still tap a shape while you look at it from elsewhere.

[`engine.activeCamera`](/module/engine/engine#activecamera) is the camera on screen. [`engine.currentCamera2D`](/module/engine/engine#currentcamera2d) is the one the game set. They differ only while a debug camera is on.

The 2D camera pans with W, A, S, and D, and zooms with E (in) and Q (out). The 3D fly camera moves with W, A, S, and D, rises with E, and sinks with Q. The arrow keys turn it. Click the canvas to turn it with the mouse, and press Esc to release the mouse. The scroll wheel sets the fly speed, and holding Shift sprints. The HUD's camera pad has buttons for the same moves, for touch screens.

### Pausing

`P` calls [`engine.setPaused`](/module/engine/engine#setpaused). It stops `onUpdate`, `onFixedStep`, physics, and tweens, while rendering and the debug cameras keep running. You can explore a frozen frame. [`host.pause()`](/module/engine/enginehost#pause) is different: it stops the ticker, so nothing renders.

## Advanced usage

This section describes each panel, custom panels, the URL flags, and how to read the performance numbers.

### The hub window

The hub window shows FPS and CPU work per frame (p50, p95, p99, and max) with a frame graph. It has buttons to open each panel and toggles for pause, outlines, the grid, and the camera mode. With more than one stage attached, a stage selector picks which stage the panels show.

FPS comes from the real time between frames. The CPU numbers come from [`engine.lastFrameWorkSec`](/module/engine/engine#lastframeworksec), the CPU time from the start of a frame to the end of rendering. Idle waits don't count. A frame on a 60 Hz display that has room to spare reads 1 to 10 ms here, even though frames arrive every 16.7 ms.

### Scene panel

The Scene panel shows the active camera, its viewport, and its pixels per world unit. You can make another camera current from here. It counts nodes and live particles in the stage.

The scene tree lists 2D, 3D, and group nodes together. Chips mark cameras, hidden nodes, physics world roots, rigid bodies, particle counts, and triangle counts. Selecting a node outlines it and shows its position, scale, alpha, bounds, and behaviors.

### Rendering panel

The Rendering panel shows the cost of a frame. A status row shows the backend, the MSAA setting, and a health chip that lists any reading outside its good range, worst first.

Below that, cards show draw calls, p95 frame time, pictures painted, bytes uploaded, primitives, and stale pictures. Each card has a sparkline of recent frames and a color: green for good, amber for a warning, red for bad. Gauges show the label cache, path-shadow mask memory, and offscreen memory against their limits.

Hover any card, gauge, or row for a tooltip. It says what the number counts and what a bad reading costs, and shows the good and warning ranges with the reading marked. The thresholds are heuristics from benchmarks, not hardware limits. The table lists the card thresholds.

| Reading                  | Good up to | Warning up to |
| ------------------------ | ---------- | ------------- |
| Frame time (p95)         | 16.7 ms    | 33 ms         |
| Draw calls per frame     | 30         | 150           |
| Pictures painted         | 2          | 20            |
| Bytes uploaded per frame | 256 KB     | 2 MB          |
| Primitives written       | 2,000      | 10,000        |
| Stale pictures           | 0          | 0             |

Collapsible groups follow. Batching (open by default) has program, texture, and blend switches, the share of draws merged, uniform slices, passes, and submits. Pictures, Instances, and Caches give more detail. Caches shows each retained cache against its memory budget, and in development the pictures that streamed the most bytes last frame.

Rows marked "cumulative" count since startup, because cache and bake work is bursty and reads 0 in most single frames. The 3D group appears when the scene has 3D content.

Debug views has the render mode and a toggle for perf marks. The Textures group is an inspector for the sprite atlas, the label page, and each render target.

### Render modes

The render mode recolors what the 2D batcher draws. These are the 2D modes:

- `polygons`: outlines every fill's polygon
- `overdraw`: adds dim red for every layer drawn, so areas drawn many times glow
- `batch-color`: gives each batch its own color
- `clip-mask`: overlays the bitmap clip mask that you inspect

With 3D content, the list also has `wireframe`, `unshaded` (flat albedo), `normals`, and `ao` (raw ambient occlusion) for the mesh pass. Picking a mode for one pipeline resets the other to normal.

### Quality panel

The Quality panel shows whether the frame keeps up and what limits it. It compares CPU p95 and GPU time per frame against the frame budget. GPU time needs browser support: timer queries on WebGL2, or the `timestamp-query` feature on WebGPU.

A row of presets sets every setting at once: Auto, Max, Balanced, Efficient, and Minimal. Below, the five settings the engine can lower on its own are each set to Auto or fixed at a value: render scale, MSAA, 3D shadows, ambient occlusion, and its resolution.

Auto shows the value in use and, when the engine has lowered it, what it was lowered from. Each option shows its share of native pixel work, the render-target memory it holds, and how it looks. Some options also show a saving measured on named hardware. Settings that do nothing in the current scene, such as the 3D ones in a 2D scene, are listed apart.

The Fixed settings group holds what the engine never lowers: frame cap, timestep smoothing, shadow map size, anisotropy, path shadows, dither, and the backend.

### Saved quality settings

The host saves settings you fix in the panel to `localStorage`. It keys them by screen size and pixel density, and applies them when the page loads, with the panel closed or open. `?quality=reset` clears them and `?quality=off` ignores them and stops saving. The host option `qualityProfile: false` turns this off in code.

[`engine.qualityControl`](/module/engine/engine#qualitycontrol) does the same from code:

```ts
engine.qualityControl.setFixed('msaa', 2) // hold MSAA at 2x
engine.qualityControl.setAuto('msaa') // hand it back to the engine
engine.qualityControl.applyPreset('efficient')
```

The engine applies a fixed setting every frame, even if the scene sets the same setting itself, and the adaptive controller never lowers it.

### Physics panel

The Physics button appears in the hub when the stage has a physics world. The panel has toggles for four overlays: collider outlines, AABBs, contact points with normals, and velocity arrows. Colliders are blue for static bodies, green for dynamic, and orange for kinematic, and dimmed while asleep.

Each world gets a stats block with its own color. The block shows bodies, contacts, sleeping, dynamic, static, and kinematic counts, gravity, and whether the world is at rest. The overlay draws each world in its color, so two worlds in one stage are easy to tell apart. See [Physics](/guides/physics).

### Input panel

The Input panel toggles the pointer overlay. It shows the pointer in screen pixels and in world units, the canvas size in CSS and device pixels, and the pixel ratio. For each active pointer it lists the type, the screen and world position, and the node that captured it.

### Custom panels

[`registerPanel`](/module/debug/debugcontroller#registerpanel) adds your own panel to the hub. It takes a {@link DebugPanelSpec} and returns a function that removes the panel. The component receives `debug` plus any `props` you pass.

```ts
const off = host.debug.registerPanel({
  id: 'board-state',
  title: 'Board',
  component: BoardStatePanel,
  props: { board },
})
// Later, when the component that owns `board` unmounts:
off()
```

Registering the same `id` again replaces the panel. Panels sort by `order`, and panels with no `order` follow in registration order.

### URL flags

The host reads these flags from the page URL:

- `?debug=hud` opens the HUD on boot.
- `?debug=perf` opens the HUD and turns on perf marks.
- `?msaa=N` sets the MSAA sample count when the host options don't. It accepts `0`, `2`, `4`, and `8`, and defaults to 4.
- `?quality=reset` and `?quality=off` control saved quality settings.

The backend picker in the Quality panel reloads the page with `?gfx=webgpu` or `?gfx=webgl2`, or without `gfx` for auto. The engine doesn't read `?gfx` itself. Your app reads it and passes the value as the `backend` option of {@link mountEngine}.

### Perf marks

With `?debug=perf`, or the toggle under Debug views, the engine wraps work in `performance` marks. The browser profiler's user-timing lane then shows each span by name. The marks cost time themselves, so leave them off otherwise.

The engine emits these spans:

| Span                                                                      | Meaning                                                                                                 |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `update <id>`                                                             | One node's `onUpdate`                                                                                   |
| `draw <id>`                                                               | One node's draw or picture replay                                                                       |
| `clear`, `3d`, `ao`, `draw2d`, `debug-overlay`                            | One render phase of a stage                                                                             |
| `gfx submit draws=… passes=… surfaces=… uboSlices=… bytes=… target=WxHxN` | Uploading the frame's data and replaying every recorded draw, with the frame's counters and target size |
| `gfx offscreen surface WxH`                                               | One offscreen surface pass                                                                              |
| `gfx present`                                                             | Copying the frame to the canvas, absent when the last pass already wrote it                             |
| `lottie evaluate`                                                         | Sampling a Lottie animation at a new frame                                                              |

The profiler drops a measure's detail object, so the counters are part of the span name. The spans measure the time JavaScript spends issuing work, not GPU time.

### Reading the numbers

Three readings usually point at a real problem.

A draw-call count that grows with the object count means batches are breaking. Per-object colors, interleaved textures, and clip changes inside a loop are the usual causes. See [Drawing](/guides/drawing).

A label page reset means every label in the scene was drawn again in one frame. It shows in the Caches group and the texture inspector. See [Text](/guides/text).

Bytes uploaded grow with the number of primitives that the renderer doesn't keep between frames. Each stream doubles when a frame needs more room. After 60 frames under a quarter full, it halves again, down to its starting size.

The path-shadow rows in Caches help tune shadow budgets. `Outline tessellations` that climb while the camera is still mean a stroke outline is built again every frame. A low `Bake pool hit rate` means mask bakes don't reuse render targets. `Mask memory` that keeps climbing means `quality.vector.shadowMaskBudgetBytes` is larger than the scene needs. See [Path shadows](/path-shadows) for what each budget bounds.

### Demos

`?demo=<name>` boots a sandbox scene from the engine's `dev/` folder instead of the app. `dev/demos.ts` lists them. Each is a short file that exercises one subsystem, and `dev/demo-scene.ts` is the shortest end-to-end example. `?demo=bench&marks` runs the benchmark demo with perf marks on.

## See also

- {@link DebugController}: HUD state, hotkeys, overlays, and stats
- {@link DebugPanelSpec}: a custom HUD panel
- {@link DebugCamera}: the free 2D debug camera
- {@link FrameStats}: the frame-time ring buffer behind the CPU readout
- {@link PhysicsOverlayFlags}: physics overlay toggles
- {@link QualityControl}: fixed and auto quality settings
- {@link EngineHostOptions}: the `debug` and `qualityProfile` options
- [Physics](/guides/physics): worlds, bodies, and the physics overlay
- [Drawing](/guides/drawing): batching and what the renderer keeps
- [Text](/guides/text): the label cache
- [Path shadows](/path-shadows): shadow mask budgets

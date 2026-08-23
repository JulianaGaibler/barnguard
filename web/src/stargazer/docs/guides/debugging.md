# Debugging

The engine ships a debug HUD: a set of draggable panels over the canvas plus a
free camera, outline overlays, and per-node timing. It is always constructed, so
nothing needs enabling in a build to reach it.

## Getting in

`?debug=hud` opens the HUD on boot. `?debug=perf` opens it and turns on per-node
`performance` marks. Press `Y` at any time to toggle it. An app can also drive it
through `host.debug.setHudVisible(...)`, which is how a booth menu exposes it
without a URL.

Two more flags matter while debugging rendering. `?msaa=` sets the sample count
(`0`, `2`, `4`, `8`), and `?gfx=` forces a backend (`webgpu` or `webgl2`) instead
of letting the probe pick.

## Hotkeys

| Key | Effect                                                         |
| --- | -------------------------------------------------------------- |
| `Y` | Show or hide the HUD                                           |
| `C` | Toggle the 2D pan and zoom debug camera                        |
| `V` | Toggle the 3D fly camera                                       |
| `O` | Outline node bounds                                            |
| `L` | Outline layout boxes                                           |
| `X` | Toggle the grid                                                |
| `T` | Toggle the pointer overlay                                     |
| `G` | Follow the selected node                                       |
| `P` | Freeze updates, tweens, and the fixed step, but keep rendering |
| `R` | Reset the debug camera                                         |

While a debug camera drives the view, WASD pans (or strafes in 3D), and holding
Shift sprints the 3D fly camera.

## The debug camera

`C` and `V` take the view away from the game camera without touching it. Input
still reprojects through whichever camera is active, so a shape stays tappable
while you pan around it. `engine.activeCamera` is what is on screen and
`engine.currentCamera2D` is what the game set, and the difference is exactly
this.

`P` is the other half of inspection. It freezes game state (`onUpdate`,
`onFixedStep`, tweens) while rendering and the debug camera keep running, so a
frozen frame is still explorable. That is `engine.setPaused(true)`, distinct from
`host.pause()`, which stops the ticker outright.

## The panels

**Scene** shows the one unified tree, 2D, 3D, and group nodes together and
colored by class. Selecting a node outlines it in its own space. A
`Viewport2DNode`'s embedded 2D scene nests under it.

**Rendering** is where a frame's cost reads. Draw calls, program switches,
texture binds, blend switches, per-family instance counts, and ring-buffer
overflow warnings. Under it sit the live overrides: MSAA count, backend
preference, a debug render mode, the 3D quality knobs, and a texture inspector
listing the sprite atlas, the label page, and each render target as a separate
source.

The render modes recolor fills so you can see what the batcher sees. `polygons`
outlines every fill's polygon, `overdraw` accumulates dim red under additive
blend so hot regions glow, `batch-color` gives each batch flush its own hue, and
`clip-mask` overlays the inspected bitmap mask.

**Physics** lists every registered world with its own stats block, and the
overlay draws each one in its own color with a boundary and a label. See
[Physics](/guides/physics).

**Input** shows live pointers with their screen and world positions and what each
one captured.

## Reading the numbers

`engine.lastFrameWorkSec` is CPU work inside the frame, measured entry to
render-end, so an idle wait does not inflate it. A well-behaved 60 Hz frame reads
1 to 10 ms there despite the 16.67 ms interval between frames.

Three readings usually point at a real problem.

`overflowWarns` above zero means a vertex ring filled mid-frame and forced an
extra submit. Either the scene draws far more than expected, or a loop is
unbounded.

A label page wipe means every label in the scene re-rasterized in a single
frame. It shows in the texture inspector alongside evictions and size clamps.
See [Text](/guides/text).

A draw-call count that scales with object count means batches are breaking. The
usual causes are per-object color strings, interleaved textures, and clip changes
inside a loop. See [Drawing](/guides/drawing#keeping-the-batch-intact).

`?debug=perf` wraps each node's update and draw in `performance` marks, so the
browser profiler's user-timing lane shows a per-node flame chart and a per-phase
breakdown of the frame. Leave it off otherwise, since the marks themselves cost.

## Demos

`?demo=<name>` boots a sandbox scene instead of the app. They live in
`stargazer/dev/` and are registered in `dev/demos.ts`, and each one is a short
readable file that exercises one subsystem. `dev/demo-scene.ts` is the shortest
end-to-end read.

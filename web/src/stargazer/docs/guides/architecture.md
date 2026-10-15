---
title: Architecture
group: Getting started
order: 2
---

# Architecture

Stargazer keeps your content in a tree of nodes and redraws it on every browser animation frame. This page describes that model: the node tree, the frame loop, and what one frame does. Read it when you want to know when your code runs and in what order. The advanced part describes how the renderer turns the tree into GPU work.

The main types are {@link Engine}, which runs the loop, {@link Stage}, which is one canvas with its own tree, and {@link SceneTree}, which holds the nodes. [Engine setup](/guides/setup) shows how to create them.

## Basic usage

Your code builds a tree of nodes and changes it over time. The engine does the rest each frame: it runs your update code, places the nodes, and draws them.

### The node tree

A {@link SceneTree} has one root, a {@link GroupNode}, and holds 2D and 3D nodes together. Every 2D node is a {@link Node2D}, for example a {@link ShapeNode}, a {@link Path2DNode} or a {@link TextNode}. Every 3D node is a {@link Node3D}. Both share the {@link Node} base, which owns the children, the behaviors and the node's lifecycle.

A node's `transform` is relative to its parent. The engine computes each node's world transform as the parent's world transform times the node's own. A 2D node uses the nearest 2D ancestor, and a 3D node the nearest 3D ancestor. See [3D](/guides/3d) for mixed trees.

A {@link Behavior} adds logic to a node through `onAttach`, `onDetach`, `onUpdate(dt)` and `onFixedStep(fixedDt)`. A node can have several behaviors. `node.getBehavior(Ctor)` finds one by class.

Every node has an `AbortSignal`. `node.destroy()` aborts it before it destroys the children, so the node's pending `tween`, `wait` and `animate` promises reject with `AbortError`. See [Scene graph](/guides/scene) and [Animation](/guides/animation).

### The frame loop

The {@link Ticker} runs the loop on `requestAnimationFrame`. Each frame it computes `dt`, the time since the last frame in seconds. It limits `dt` to `maxDt` (default `1/30`), so a stalled tab doesn't move objects across the world in one frame. By default it also smooths `dt` to remove timer jitter.

The ticker also runs a fixed step, 120 times a second by default (`fixedStepHz`). Use it through `onFixedStep` for work that must not depend on the frame rate, such as physics. The ticker adds each frame's `dt` to a running total and runs as many fixed steps as fit in it, at most 8 per frame. After a long stall it drops the time left over. [`ticker.fixedAlpha`](/module/engine/ticker#fixedalpha) is the fraction of a step left over, for smoothing positions between fixed steps in `onUpdate`.

### What a frame does

On each animation frame the engine first runs the fixed steps that are due. Each fixed step does this:

1. Step every registered physics world.
2. Call `onFixedStep` on each node that has fixed-step work, and then on its behaviors, in tree order, on every active stage.

Then the engine runs the frame itself:

1. Call the [`onBeforeFrame`](/module/engine/engine#onbeforeframe) handlers. Code that moves the camera goes here.
2. Update pointer world positions on every interactive stage.
3. Advance tweens and waits.
4. Call `onUpdate` on each node that has update work, and then on its behaviors, in tree order, on every active stage.
5. Lay out every {@link LayoutRoot} that changed.
6. Compute world transforms on every active stage.
7. Render every active stage: the 3D pass, then the 2D nodes, then post-processing.
8. Emit `frame` on `engine.events`.

While `engine.setPaused(true)` is in effect, the engine skips the fixed steps and frame steps 2 to 4. The rest still runs, so the debug camera moves and a resize still lays out the scene again.

[`engine.capture`](/module/engine/engine#capture) renders outside this loop. It lays out, transforms, and renders its own inactive stage directly, so it also works while the ticker is stopped. See [Stages](/guides/stages).

The order has a reason. A camera that moves in step 1 is already in place when step 2 maps pointers to world positions. Pointers are current when your `onUpdate` reads them in step 4. Tweens advance before `onUpdate`, so update code reads this frame's tweened values.

This example registers a handler for step 1:

```ts
const off = engine.onBeforeFrame((dt) => {
  followCamera(dt) // ease the camera toward its target
})
off() // remove the handler
```

### Coordinate spaces

The engine uses three coordinate spaces:

- World coordinates are the units your scene uses. `node.transform.x` and `node.hitTest` use them.
- Screen coordinates are CSS pixels on the canvas. Pointer events arrive in them.
- Device pixels are the canvas's physical pixels. Only the renderer uses them.

A {@link CameraNode2D} fits its world `viewport` rectangle into the canvas at one scale, without distortion. When the canvas has a different aspect ratio, extra world shows on two sides. The camera converts between world and screen coordinates:

```ts
const cam = engine.currentCamera2D!
const world = cam.screenToWorld(cssX, cssY)
const screen = cam.worldToScreen(node.transform.x, node.transform.y)
```

Both methods take an optional `out` vector, so a per-frame loop doesn't allocate. The stage multiplies the camera transform by the device pixel ratio, so your code never handles device pixels. See [Camera](/guides/camera).

### Draw order

2D nodes draw in tree order: a node before its children, and siblings in the order they were added. To draw a node under content added before it, insert it at its place with `addAt` or `insertBefore`. A node's alpha multiplies into its children's. A hidden node hides its whole subtree. See [Scene graph](/guides/scene).

## Advanced usage

This section describes how a stage turns the tree into GPU work: pictures, the command list, passes, the 3D pass and the backends. It also covers stages and the Svelte boundary.

### Pictures and the 2D walk

A 2D node draws in one of two ways. A node with `paint(canvas)` records its drawing into a {@link Picture} through a {@link Canvas}. The stage keeps the picture and replays it every frame. It records the picture again only when the node is marked for repaint, for example when a paint property changes or the node calls [`markNeedsPaint`](/module/camera/cameranode2d#markneedspaint). A node with `draw(gfx, camera, dt)` draws into {@link Gfx2D} directly, every frame.

Each frame the stage walks the tree once in draw order. For each visible 2D node it repaints the picture if needed, skips the node when its bounds are known and outside the view, and replays the picture under the node's world transform and alpha. The walk also applies clips, `InsetViewNode` views, and {@link Layer} spaces and effects. See [Drawing](/guides/drawing) for the `Canvas` rules.

### The command list

The 2D renderer, `GpuGfx`, implements {@link Gfx2D}. It doesn't draw during the walk. It records:

- Each draw call appends its vertex or instance data to a stream that belongs to its shader program.
- A change of program, texture, blend mode or clip ends the current run and starts a new one. A run is one future draw call.
- Alpha, color and transform go into the per-instance data, so they don't end a run.

At the end of the frame the renderer submits the list. First it joins runs: a run joins an earlier run with the same program and state when no run between them touches the same pixels. Then it uploads each stream once and replays the runs in draw order. The streams grow when a frame needs more room, up to 256 MB each.

### Passes and surfaces

Some nodes draw into an offscreen surface first, and the surface is then drawn into the frame. A {@link Layer} with effects or a raster cache does this. So does a node with `compositeGroup`, a `compositeBlend` other than `'source-over'`, or a `matte`.

In the command list, a surface's runs sit between a begin mark and an end mark. At submit time the renderer gives every surface a render pass of its own and runs those passes before the main pass. A nested surface comes before the surface that contains it. A layer's effects run when its pass closes. The main pass then draws the frame without stopping, and it composites each surface where the node sat in draw order.

One stage frame runs in this order:

1. Bake masks for path shadows that the previous frame asked for.
2. Render the 3D shadow maps and ambient occlusion, if the stage has 3D content.
3. Record the 2D walk and the debug overlays.
4. Run every surface pass.
5. Run the main pass: clear, draw the 3D meshes, then the 2D runs.
6. Run post-processing, if any effect is active. It reads the frame and writes the canvas.

Without post-processing, the main pass writes the canvas directly when `directPresent` is on. See [Post-processing](/guides/post-processing).

### The 3D pass

A stage with 3D content gives its frame target a depth attachment, and `MeshRenderer` draws the {@link Node3D} meshes at the start of the main pass. The 2D runs follow in the same pass and draw on top. When the last 3D node leaves the tree, the stage drops the depth attachment again. A 2D-only stage never creates one. See [3D](/guides/3d).

### Backends

`GpuGfx` and `MeshRenderer` draw through `GfxDevice`, an interface that follows WebGPU: immutable pipelines, render passes with load and store operations, bind groups, and draws that state all their inputs. The WebGPU backend implements it directly, and the WebGL2 backend emulates it. Code above the interface is the same for both.

Shaders are written in WGSL. The WebGL2 backend loads GLSL files generated from them, named `*.gen.vert.glsl` and `*.gen.frag.glsl`. Don't edit those by hand.

Pipelines compile asynchronously when a stage starts. The stage skips frames until they are ready. On WebGL2 that is less than one frame.

### Stages

A {@link Stage} is one canvas with its own {@link Renderer}, scene tree, cameras, GPU context and render target. The engine owns the primary stage at `engine.primaryStage`. `engine.tree`, `engine.renderer` and `engine.currentCamera2D` read from it.

[`engine.attachStage`](/module/engine/engine#attachstage) adds a stage for another canvas. All stages share the ticker, the tween animator and the pause flag. Only the primary stage and stages created with `interactive: true` receive pointer input. See [Stages](/guides/stages).

### The Svelte boundary

Svelte code talks to the engine through the {@link EngineHost}. Commands go in: `start`, `stop`, `pause`, `resume`, `destroy` and `loadScene`. Events come out on `host.events`, typed by {@link EngineEvents}.

Your own game events belong on an {@link Emitter} that you create with {@link createEmitter}. The engine doesn't know about them. Two helpers connect emitters to Svelte:

- {@link mountEngine} is a `<canvas>` action that creates the host and destroys it on unmount.
- {@link emitterStore} and {@link latestEventStore} turn an emitter event into a readable store.

Use stores for events that fire now and then. Read per-frame values with `on` inside a `$effect`. The store helpers warn when given `frame` or `pointerMove`, because those update Svelte many times per second.

```ts
// An event that fires a few times a minute, as a store.
const score = emitterStore(game.events, 'score', 0) // {$score} in markup

// A per-frame value, read without a store.
$effect(() => host.events.on('frame', ({ dt }) => updateFpsMeter(dt)))
```

## See also

- {@link Engine}: the frame loop and the subsystems
- {@link Ticker}: the clock and the fixed step
- {@link SceneTree}: the tree a stage draws
- {@link Stage}: one canvas with its own tree
- {@link Picture}: the recorded drawing of a node
- {@link Gfx2D}: the 2D drawing interface
- [Engine setup](/guides/setup): mounting the engine and its options
- [Scene graph](/guides/scene): nodes, behaviors and draw order
- [Drawing](/guides/drawing): painting nodes and what breaks a batch
- [Stages](/guides/stages): more canvases on the same clock
- [3D](/guides/3d): meshes, lights and the 3D pass

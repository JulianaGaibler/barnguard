# Stargazer

Stargazer is a 2D game engine with an optional 3D pass, written in TypeScript.
It has a scene graph, cameras, input, animation, layout, text, particles,
physics, and a GPU renderer with a WebGPU and a WebGL2 backend. A Svelte 5
action mounts it on a canvas.

The engine knows nodes, transforms and pixels. Your game owns the rules and the
state.

## Getting started

Import everything from `@src/stargazer`. Internal subpaths are not part of the
public API.

This example creates a host on a canvas, adds a camera and draws one circle:

```ts
import { createEngineHost, CameraNode2D, ShapeNode } from '@src/stargazer'

const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)
  cam.makeCurrent()

  scene.root.add(
    new ShapeNode({
      geometry: { kind: 'circle', radius: 40 },
      fill: '#ffd34d',
    }),
  )
})

host.start()
```

[`createEngineHost`](/module/engine/createenginehost) returns an [`EngineHost`](/module/engine/enginehost). The camera frames a
1920 × 1080 world rect and fits it into the canvas. The circle sits at the world
origin.

A stage has no camera until you add one. Without a current camera it draws
only the clear color.

### In a Svelte component

The [`mountEngine`](/module/svelte/mountengine) action builds the host for you. It picks a backend,
handles resizing and context loss, and destroys the host when the component
unmounts:

```svelte
<script lang="ts">
  import { mountEngine } from '@src/stargazer'
  import type { EngineHost } from '@src/stargazer'

  async function onReady(host: EngineHost): Promise<void> {
    await host.loadScene((scene, engine) => {
      /* ... */
    })
    host.start()
  }
</script>

<canvas use:mountEngine={{ options: { clearColor: '#0d1a2c' }, onReady }}
></canvas>
```

The Svelte layer is the only part of the engine that touches the DOM.

## How it works

These are the ideas the guides build on.

### A tree of nodes

Everything on screen is a [`Node2D`](/module/scene/node2d). A node has a transform, children and
optional [`Behavior`](/module/scene/behavior) objects that run every frame.

A node draws in one of two ways. A `paint(canvas)` hook records its drawing
once, and the engine replays it every frame until the node changes. A
`draw(gfx)` hook draws through the immediate-mode [`Gfx2D`](/module/render/gfx2d) facade every
frame. To reuse a piece of scene, write a function that returns a subtree.

### One command list per frame

Draws go into a command list that the renderer replays in painter order at the
end of the frame. Alpha, color and transform are per-instance data, so they
don't split a batch. A typical 2D frame takes a few draw calls.

Offscreen groups, such as a [`Layer`](/module/scene/layer) with a blur, render into their own
surfaces before the main pass. The main pass then draws everything else.

### Shapes and text

Circles and rounded rects are signed distance fields, evaluated per pixel in
local space. They stay sharp under any scale or rotation.

Text is shaped and rasterized by the browser's Canvas 2D API, then drawn as a
cached textured quad. Kerning, ligatures, complex scripts and color emoji work
because the browser does the shaping.

### Two backends

WebGPU and WebGL2 implement the same device interface. It follows WebGPU's
model: immutable pipelines, render passes with load and store operations, bind
groups and explicit draws. Node code never sees the backend.

### Beyond the canvas

You can pin HTML elements to nodes so they follow the camera's pan and zoom. An
opt-in accessibility layer mirrors chosen nodes into a hidden ARIA tree for
screen readers and keyboard navigation.

Optional systems allocate on first use. Layout, physics, post-processing,
ambient occlusion, accessibility and DOM overlays cost nothing until you use
them.

## Guides

The sidebar lists the guides in the order below.

### Getting started

Read these four in order.

- [Engine setup](/guides/setup): the host and the engine, options, lifecycle,
  context loss
- [Architecture](/guides/architecture): how the parts fit and what a frame does
- [Scene graph](/guides/scene): `Node2D`, `Behavior`, transforms, draw order
- [Drawing](/guides/drawing): `paint` and `draw`, fills, strokes, clips,
  groups and layers

### Features

Each of these covers one feature. The first six are the ones most games use.

- [Camera](/guides/camera): framing a viewport, moving and zooming,
  `animateTo`
- [Input](/guides/input): pointer capture, hit testing, mapping to world
  coordinates
- [Animation](/guides/animation): `tween`, `Timeline`, canceling with an abort
  signal
- [Text](/guides/text): `fillText`, `TextNode`, measuring, the label cache
- [Layout](/guides/layout): constraint-based boxes, `Row` and `Column`, resizing
- [Debugging](/guides/debugging): the HUD, the free camera, reading frame cost
- [Assets](/guides/assets): SVG paths, bitmap masks, keyed async loading
- [Lottie](/guides/lottie): loading, playback, markers, diagnostics
- [Particles](/guides/particles): pooled sprite emitters
- [Vector particles](/guides/vector-particles): bursts with your own
  per-piece paint code
- [Physics](/guides/physics): the opt-in 2D rigid-body world
- [Post-processing](/guides/post-processing): screen-space effects
- [HTML overlays](/guides/html-overlays): pinning elements to nodes
- [Accessibility](/guides/accessibility): the hidden ARIA mirror
- [Stages](/guides/stages): a second canvas on the same clock, capturing a
  scene as an image
- [Adversarial search](/guides/ai): negamax for a turn-based opponent

### 3D

- [3D](/guides/3d): meshes, glTF, lights, 2D content on a quad in 3D
- [Ambient occlusion](/guides/ambient-occlusion): screen-space AO for the 3D
  pass

### Internals

These pages describe how parts of the renderer work, for people changing the
engine.

- [Combined depth and stencil](/combined-depth-stencil): one depth and stencil
  target shared by the 2D and 3D passes
- [Path shadows](/path-shadows): how drop shadows on paths are baked and cached
- [Running the benchmarks](/bench-runbook): the steps to measure one machine

## Demos and tests

Runnable demos live in `dev/`. Each is registered in `dev/demos.ts` and opens
at `?demo=<name>`. `dev/demo-scene.ts` is the shortest complete example.

The `*.test.ts` file next to each source file specifies the behavior that the
guides don't cover.

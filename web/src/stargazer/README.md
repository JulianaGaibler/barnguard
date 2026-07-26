# Stargazer

A game engine with a scene graph, camera, input, animation, particles, and opt-in physics. High-quality 2D rendering, plus a 3D scene (posed camera with an animated orthographic<->perspective blend, meshes, glTF loading, and 2D content placed on quads in 3D). TypeScript, with a Svelte 5 host. It's game-agnostic: it knows nodes, transforms, and pixels, and your game owns the rest.

## Design

- **You build a node tree.** Everything on screen is a `Node2D`: a transform, children, and optional behaviors. A drawable node implements a `draw(gfx)` hook and paints through an immediate-mode `Gfx2D` facade, so a custom node is just a class that knows how to draw itself. Reuse is a plain builder function that returns a subtree.
- **Render layers decide what's cached.** Each node picks a layer. `static` content is baked once and reused until it changes; `dynamic` redraws every frame; `above-static` composites over the baked layer. You write plain per-frame draw code and the engine decides what to actually re-render, so a mostly-still scene re-renders almost nothing.
- **GPU renderer.** A WebGL2 backend records a frame's draws into a command list and submits once: instanced draw programs, SDF analytic anti-aliasing, texture and label atlases, and retained geometry for static meshes. A typical frame is a handful of draw calls. MSAA and bitmap-mask clipping are built in, and a thin `GfxDevice` seam leaves room for a WebGPU backend.
- **Past the canvas.** Pin HTML elements to nodes and they track the camera's pan and zoom; opt into an accessibility layer that mirrors chosen nodes into a hidden ARIA tree for screen readers and keyboard nav; and reach for the built-in adversarial game search (negamax with alpha-beta) for turn-based opponents.

## Getting started

Import from `@src/stargazer`. Internal subpaths are not part of the public API.

```ts
import { createEngineHost } from '@src/stargazer'

const host = createEngineHost({
  canvas: myCanvas,
  clearColor: '#0d1a2c',
  initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
})

await host.loadScene((scene, engine) => {
  // build the scene tree here
})

host.start()
```

In a Svelte component, use the `mountEngine` action instead of building the host by hand. It wires resize, context loss, and destroy for you:

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

<canvas
  use:mountEngine={{
    options: { clearColor: '#0d1a2c' },
    onReady,
  }}
></canvas>
```

The Svelte host is the only part that touches the DOM. Everything else runs on the canvas. For the options, the lifecycle calls, and reaching the subsystems, see [Engine setup](/guides/setup). To pin HTML elements to scene nodes, see [HTML overlays](/guides/html-overlays).

## Relevant next docs

- [Engine setup](/guides/setup), host vs engine, options, lifecycle, context loss
- [Architecture](/guides/architecture), how the pieces fit together and the per-frame order
- [Scene graph](/guides/scene), Node2D, Behavior, transforms, render layers
- [Layout](/guides/layout), opt-in constraints-based boxes, Row/Column, LayoutRoot, resize
- [Camera](/guides/camera), viewport, uniform aspect fit, `animateTo`
- [3D](/guides/3d), the 3D world, `Camera3D`, meshes, glTF, 2D-in-3D, picking
- [Post-processing](/guides/post-processing), screen-space effects — vignette, chromatic aberration, edge blur, custom passes
- [Input](/guides/input), pointer capture, hit testing, world reprojection
- [Animation](/guides/animation), `tween`, `wait`, `Timeline`, the abort contract
- [Text](/guides/text), `fillText`, `TextNode`, label caching and animation cost

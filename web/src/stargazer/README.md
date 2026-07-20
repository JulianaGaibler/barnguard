# Stargazer

A 2D game engine with a scene graph, camera, input, animation, particles, and opt-in physics. TypeScript, with a Svelte 5 host.

Rendering runs on WebGL2 (`GpuGfx`): MSAA, bitmap-mask clipping, and batched draw programs for fills, textured quads, strokes, SDF glyphs, radial gradients, and cached text labels. A Canvas 2D backend (`Canvas2DGfx`) exists as a visual-parity oracle for debugging and as a fallback; opt into it with `?renderer=canvas2d`. Nodes draw through the shared `Gfx2D` facade and never see which backend is live.

The engine is game-agnostic. It knows about nodes, transforms, and pixels; your game code owns everything else.

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
- [Scene graph](/guides/scene), SceneNode, Behavior, transforms, render layers
- [Camera](/guides/camera), viewport, uniform aspect fit, `animateTo`
- [Input](/guides/input), pointer capture, hit testing, world reprojection
- [Animation](/guides/animation), `tween`, `wait`, `Timeline`, the abort contract
- [Text](/guides/text), `fillText`, `TextNode`, label caching and animation cost

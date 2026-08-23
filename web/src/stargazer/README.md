# Stargazer

A 2D-first game engine with an optional 3D pass. Scene graph, camera, input,
animation, layout, text, particles, opt-in physics, and a GPU renderer with two
backends. TypeScript, with a Svelte 5 host. It is game-agnostic: it knows nodes,
transforms, and pixels, and your game owns the rest.

## Design

- **You build a node tree.** Everything on screen is a `Node2D`: a transform,
  children, and optional behaviors. A drawable node implements a `draw(gfx)`
  hook and paints through the immediate-mode `Gfx2D` facade, so a custom node is
  a class that knows how to draw itself. Reuse is a plain builder function that
  returns a subtree.
- **One command list per frame.** Draws append into per-program ring buffers,
  batches break only on program, texture, blend, or clip changes, and the whole
  list replays in painter order at frame end. Alpha, color, and transform fold
  into per-instance data and never break a batch. A typical frame is a handful
  of draw calls.
- **Shapes are analytic, text is a bitmap.** Circles and rounded rects are
  signed distance fields evaluated in local space, so they stay crisp under any
  transform. Text is shaped and rasterized by the platform Canvas 2D engine and
  drawn as a cached textured quad, which is why kerning, ligatures, complex
  scripts, and color emoji all work.
- **Two backends, one seam.** WebGPU and WebGL2 both implement `GfxDevice`,
  which is modelled on WebGPU semantics: immutable pipelines, render passes with
  load and store ops, bind groups, and fully explicit draws. Node code never
  sees either one.
- **Past the canvas.** Pin HTML elements to nodes and they track the camera's
  pan and zoom. Opt into an accessibility layer that mirrors chosen nodes into a
  hidden ARIA tree for screen readers and keyboard navigation.

Everything optional costs nothing until touched. Layout, physics,
post-processing, ambient occlusion, accessibility, and DOM overlays each
allocate on first use.

## Getting started

Import from `@src/stargazer`. Internal subpaths are not part of the public API.

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

A stage has no camera until you add one, and it renders only the clear color
until a camera is current. That is the one piece of setup with no default.

In a Svelte component use the `mountEngine` action instead of building the host
by hand. It picks a rendering backend, wires resize and context loss, and
destroys the host on unmount:

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

The Svelte host is the only part that touches the DOM. Everything else runs on
the canvas.

## Where to go next

Read the first four in order. The rest are reference for when you need them.

- [Engine setup](/guides/setup), host versus engine, options, lifecycle, context loss
- [Architecture](/guides/architecture), how the pieces fit and what a frame does
- [Scene graph](/guides/scene), `Node2D`, `Behavior`, transforms, render layers
- [Drawing](/guides/drawing), the `Gfx2D` facade, custom `draw`, batching, clips
- [Camera](/guides/camera), viewport framing, transform cameras, `animateTo`
- [Input](/guides/input), pointer capture, hit testing, world reprojection
- [Animation](/guides/animation), `tween`, `Timeline`, the abort contract
- [Text](/guides/text), `fillText`, `TextNode`, measurement, label caching
- [Layout](/guides/layout), constraints-based boxes, `Row` and `Column`, resize
- [Assets](/guides/assets), SVG paths, bitmap masks, keyed async loading
- [Stages](/guides/stages), a second canvas on the same clock
- [Particles](/guides/particles) and [vector particles](/guides/vector-particles)
- [Physics](/guides/physics), the opt-in 2D rigid-body world
- [HTML overlays](/guides/html-overlays), pinning elements to nodes
- [Accessibility](/guides/accessibility), the hidden ARIA mirror
- [Post-processing](/guides/post-processing), screen-space effects
- [3D](/guides/3d), meshes, glTF, lights, 2D on a quad in 3D
- [Ambient occlusion](/guides/ambient-occlusion), screen-space AO for the 3D pass
- [Adversarial search](/guides/ai), negamax for a turn-based opponent
- [Debugging](/guides/debugging), the HUD, the free camera, reading frame cost

Runnable demos live in `dev/`, registered in `dev/demos.ts` and reachable as
`?demo=<name>`. `dev/demo-scene.ts` is the shortest end-to-end read. The
colocated `*.test.ts` files serve as specs for anything the guides leave out.

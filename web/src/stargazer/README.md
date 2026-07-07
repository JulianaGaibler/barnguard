# Stargazer 2

A 2D game engine with Scene graph, camera, input, animation, particles, and a dev-only debug HUD. TypeScript, Svelte 5 host.

Two rendering backends behind the same `Gfx2D` facade:

- **WebGL2** (`GpuGfx`), default. MSAA on the FBO, bitmap-mask clipping, five instanced/batched programs (colored tri, textured quad, stroke, SDF, radial gradient).
- **Canvas 2D** (`Canvas2DGfx`), visual parity oracle, tutorial mini-stage fallback, and the `?renderer=canvas2d` opt-out.

Nodes draw through `Gfx2D` and never see which backend is live. The engine is game-agnostic. All game logic lives in `src/game/`; stargazer only knows about nodes, transforms, and pixels.

## Getting started

Import from `@src/stargazer`, everything else is internal:

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

In a Svelte component, use the `mountEngine` action instead of building the host by hand, it wires resize, context loss, and destroy for you:

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

The Svelte host is the only thing that touches the DOM. Everything else runs on the canvas.

## Module map

```
stargazer/
├── engine/       Engine, EngineHost, Ticker, the main loop and its façade
├── scene/        Scene, SceneNode, Behaviour, tree traversal
├── math/         Transform2D, Vec2, Rect, easings, DOMMatrix pool
├── render/       Renderer, Layers (static-layer bake), Stage (per-canvas surface)
├── nodes/        GroupNode, ShapeNode, PolylineNode, Path2DNode, ParticleEmitterNode
├── camera/       Camera + animateTo
├── input/        InputSystem, hit walker, PointerState
├── anim/         Animator, Timeline, abort helpers
├── particles/    ParticleEmitter, ParticlePool, sprite cache
├── events/       Typed Emitter, EngineEvents
├── debug/        DebugController, DebugCamera, DebugHud, ui primitives
├── svelte/       mountEngine + mountStage actions, emitterStore
└── dev/          demo-*.ts sandbox scenes
```

## Topic docs

- [`docs/architecture.md`](./docs/architecture.md), how the pieces fit together; the per-frame ordering
- [`docs/scene.md`](./docs/scene.md). SceneNode, Behaviour, transforms, render layers
- [`docs/camera.md`](./docs/camera.md), viewport, uniform aspect fit, `animateTo`
- [`docs/input.md`](./docs/input.md), pointer capture, hit testing, continuous world reprojection
- [`docs/animation.md`](./docs/animation.md), `tween`, `wait`, `Timeline`, abort contract
- [`docs/particles.md`](./docs/particles.md), pool, kinematics, sprite styles
- [`docs/stages.md`](./docs/stages.md), attaching a second canvas, `mountStage`, shared clock
- [`docs/debug.md`](./docs/debug.md), the dev HUD, hotkeys, and how zero-overhead-when-off works

## Sandbox demos

Every milestone shipped with a demo under `dev/demo-*.ts`. Reach them via `?demo=<name>`:

| URL               | What it shows                                              |
| ----------------- | ---------------------------------------------------------- |
| `?demo=loop`      | Bare ticker + resize + DPR                                 |
| `?demo=scene`     | Scene graph, transforms, PolylineNode smoothing            |
| `?demo=debug`     | Debug HUD in isolation                                     |
| `?demo=svg`       | SVG paths, `BitmapMask`, hover hit-tests                   |
| `?demo=input`     | Two-shape drag, multi-touch, camera-drift correction       |
| `?demo=anim`      | Timeline, destroy-mid-tween, overlap warning               |
| `?demo=particles` | Trail + burst, bloomed + sharp                             |
| `?demo=camera`    | `animateTo`, static-layer bake, shockwave promotion        |
| `?demo=stages`    | Second canvas, shared clock, `mountStage`, detach/reattach |

Combine any demo with `&debug=hud` (or `&debug=1` for hotkeys without the HUD visible) to see engine state live.

The main app at `/` is the M9 boundary demo. Germany map, state confirm dialog, packet exits Germany, game-over overlay.

## Rendering backends

The primary stage boots WebGL2 by default. Add `?renderer=canvas2d` to opt out
(useful for parity diffing or when a driver is misbehaving).

- `TutorialSession` hard-wires Canvas 2D for the mini-stage, the ~20 ms WebGL2
  context-acquire spike at state-tap is worse than any GPU win at that size.
- The debug HUD exposes render modes (`polygons`, `overdraw`, `batch-color`,
  `clip-mask`) and a live MSAA switch when GPU is active, see
  `DebugRenderMode` in `render/gfx/GpuGfx.ts` for when each mode is useful.
- `?msaa=N` (`0`/`2`/`4`/`8`). MSAA sample count. Clamped to the driver's
  `MAX_SAMPLES`.

## What's not in the engine

- Game rules (packets, paths, collision, scoring, spawn logic)
- Audio, networking, save/load
- Rigid-body physics, post-processing filters
- In-canvas text. HUD text lives in DOM overlays positioned via `camera.worldToScreen(...)`
- Automatic view interpolation between fixed steps (the hook is there, `SceneNode.prevTransform`, but nothing fills it yet)

Game work lives under `src/game/`. stargazer stays out of the way.

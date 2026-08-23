# Engine setup

This walks through standing up the engine from an empty canvas: what the host
is, how to mount it, the options worth knowing, the lifecycle calls, and how to
reach the subsystems once it runs. The [Getting started](/) snippet on the
README is the 30-second version. This is the fuller picture.

## Host and engine

Two objects sit at the top. The `Engine` owns the frame loop and the per-canvas
services (scene, camera, input, animation, renderer). The `EngineHost` wraps one
engine and owns the concerns a page needs around it: start and stop, pause and
resume, scene swapping, and graphics context-loss recovery. You build a host,
and reach the engine through `host.engine`.

Mount one host per canvas. In a Svelte component, use the `mountEngine` action.
Everywhere else, call `createEngineHost` by hand.

## Mounting in Svelte

`mountEngine` is a `<canvas>` action. It selects a rendering backend, builds the
host from the element, runs your `onReady`, and calls `host.destroy()` when the
component unmounts, so teardown is tied to the component lifecycle and you write
no `onDestroy` boilerplate.

```svelte
<script lang="ts">
  import { mountEngine, CameraNode2D, ShapeNode } from '@src/stargazer'
  import type { EngineHost } from '@src/stargazer'

  async function onReady(host: EngineHost): Promise<void> {
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
  }
</script>

<canvas
  use:mountEngine={{
    options: { clearColor: '#0d1a2c' },
    onReady,
  }}
></canvas>
```

The action supplies `canvas` from the element, so `options` is
`EngineHostOptions` without it. Keep the host reference from `onReady` if you
need `pause`, `loadScene`, or the debug controller later.

## You have to add a camera

No camera is created for you. Until a `CameraNode2D` is in the tree and
`makeCurrent()` has been called, `engine.currentCamera2D` is `null` and the
stage renders nothing but the clear color. A blank canvas on first run is almost
always this.

`loadScene` destroys the previous root's children, cameras included, so each
scene builder adds and activates its own. See [Camera](/guides/camera) for
framing, zoom, and the transform-camera model.

## Picking a backend

`mountEngine` takes `backend`: `'auto'` (the default) probes WebGPU and falls
back to WebGL2, while `'webgpu'` and `'webgl2'` force one. A canvas is committed
to its context type the moment one is acquired, so this is decided once, before
the host exists.

```svelte
<canvas use:mountEngine={{ backend: 'webgl2', onReady }}></canvas>
```

Forcing WebGL2 also takes a synchronous path, since WebGL2 acquires its context
immediately. `'auto'` and `'webgpu'` are async, because WebGPU is.

`createEngineHost` on its own always takes WebGL2, because acquiring a WebGPU
device is asynchronous and the constructor is not. Outside Svelte, run the probe
first and hand the result over:

```ts
import { selectGfxDevice, createEngineHost } from '@src/stargazer'

const { device, backend } = await selectGfxDevice(canvas, 'auto')
console.info('rendering backend:', backend)
const host = createEngineHost({ canvas, gpuDevice: device })
```

## Mounting by hand

Without Svelte, pass the canvas yourself and manage the lifecycle:

```ts
import { createEngineHost, CameraNode2D } from '@src/stargazer'

const canvas = document.querySelector('canvas')!
const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)
  cam.makeCurrent()
})

host.start()

// When the page is done with it:
host.destroy()
```

The engine sizes itself to the canvas through a `ResizeObserver`, so you don't
set pixel dimensions. Give the canvas a CSS size and the backing store follows,
device pixel ratio included.

## Options worth knowing

Everything has a default, so pass only what you change. The common ones:

```ts
const host = createEngineHost({
  canvas,
  // Frame clear. Omit both for an opaque near-black clear.
  clearColor: '#0d1a2c',
  transparent: false, // true clears to zero alpha so the CSS background shows

  // Timing.
  fixedStepHz: 120, // deterministic fixed-step rate (physics, onFixedStep)
  maxFps: 0, // render cap, 0 is uncapped
  maxDt: 1 / 30, // clamp on a single frame's dt after a stall
  smoothTimestep: true, // filter timer jitter out of the render dt

  // Rendering.
  msaaSamples: 4, // 0 disables

  // Opt-in physics on the primary stage. Off by default.
  physics: { gravity: { x: 0, y: 900 } },

  // Debug HUD initial state. Absent reads ?debug from the URL.
  debug: 'hidden', // 'hidden' | 'hud' | 'perf'
})
```

`quality` and `fog` seed the 3D renderer's live settings objects. Both are
irrelevant to a pure-2D stage. See [3D](/guides/3d).

`msaaSamples` and `debug` each resolve from the option first, then fall back to
a URL flag (`?msaa=`, `?debug=`), so a deployed build can be probed without a
code change. Pass the option explicitly to ignore the URL. See
[Physics](/guides/physics) for the physics config.

## Lifecycle

```ts
host.start() // begin the render loop, the first call emits `ready`
host.stop() // halt the loop, scene and GPU resources stay intact
host.pause() // stop the ticker for a full-screen overlay
host.resume() // undo pause()
host.destroy() // tear down: stop, drop listeners, reject pending tweens
await host.loadScene(build) // swap the scene (see below)
```

`host.pause()` stops the ticker outright, for when a menu or modal covers the
whole canvas and there is no reason to keep drawing. It differs from
`engine.setPaused(true)`, a soft freeze that keeps the ticker running so debug
tooling stays live while game updates halt. Reach for the host's `pause` for an
overlay, the engine's `setPaused` for a debug-style freeze.

## Building the scene

`loadScene` destroys the current root's children, then calls your builder to
populate the empty scene. The builder receives the scene and the engine, and may
be async, so it can await asset loads before it adds nodes:

```ts
await host.loadScene(async (scene, engine) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)
  cam.makeCurrent()

  const svg = await fetch('/map.svg').then((r) => r.text())
  const { paths } = parseSvgPaths(svg, { tessellate: true })

  const bg = new ShapeNode({
    geometry: { kind: 'rect', width: 1920, height: 1080, centered: false },
    fill: '#12233f',
  })
  bg.renderLayer = 'static' // drawn first each frame, under everything else
  scene.root.add(bg)

  // ...build the rest of the tree from `paths`
})
```

An `AssetLoader` (a keyed async cache) keeps a one-time fetch-and-parse cost
from repeating across scene reloads. Construct one and `await loader.load(key,
...)` inside the builder. See [Assets](/guides/assets).

Call `loadScene` again to swap scenes. The previous tree is destroyed for you,
which aborts its in-flight tweens and detaches its behaviors.

## Reaching the subsystems

Everything hangs off `host.engine`:

```ts
const engine = host.engine

engine.tree // the primary stage's scene tree, add nodes under tree.root
engine.currentCamera2D // the current 2D camera, or null
engine.input // the primary InputSystem (pointers, touch slop)
engine.animation // the Animator behind tween / wait
engine.renderer // pixel size, CSS size, dpr
engine.dom // HTML-overlay sync (see HTML overlays)
engine.a11y // the hidden ARIA mirror (see Accessibility)
engine.postProcess // screen-space effects (see Post-processing)
engine.physics // the primary stage's PhysicsWorld, or null if off
```

The engine also forwards the tween helpers so you don't reach into `animation`
for the common case:

```ts
await engine.tween(node.transform, { x: 400 }, { duration: 0.5 })
await engine.wait(0.2)
await engine.animate(node, { alpha: 0 }, { duration: 0.3 }) // scoped to the node
```

## Reacting to engine events

The host exposes the engine's event bus as `host.events`. Discrete events
(`ready`, `resize`, `contextlost`, `contextrestored`, `backendlost`,
`destroyed`, and the primary-canvas pointer events) are fine to subscribe to
directly:

```ts
const off = host.events.on('resize', ({ css, dpr }) => {
  console.log('canvas is now', css.w, 'x', css.h, 'at dpr', dpr)
})
// off() to unsubscribe
```

The `frame` and `pointerMove` events fire many times per second. Do not bind
those to a Svelte store. Read them in a `$effect` with `emitter.on(...)`
instead. In Svelte, `emitterStore` and `latestEventStore` turn a discrete event
into a `Readable` and warn if you point them at a high-frequency key. See
[Architecture](/guides/architecture#the-svelte-boundary).

## Context loss

A graphics context can vanish (GPU reset, tab backgrounded, driver hiccup). The
two backends recover differently, and the host handles both.

WebGL2 can restore in place. The host runs a retry ladder: it rebuilds GPU
resources when the context returns, and gives up only after three losses inside
a 60 second window or when the browser signals the loss is permanent. The
default action on giving up is a page reload.

A lost WebGPU device is terminal, and the canvas cannot be re-used for a
different context type. Recovery means remounting on a fresh canvas forced to
WebGL2, which only the component owning the `<canvas>` can do. The host emits
`backendlost` and calls `onBackendLost`, and without an override it reloads the
page.

```ts
const host = createEngineHost({
  canvas,
  onContextLost: (restorable) => {
    // The moment the context drops. Show a "reconnecting" state, say.
  },
  onReload: () => {
    // The WebGL2 retry ladder gave up. Rebuild in place instead of reloading.
  },
  onBackendLost: () => {
    // WebGPU is gone for good. Re-key the canvas and remount on 'webgl2'.
  },
})
```

The `contextlost`, `contextrestored`, and `backendlost` engine events fire
alongside these, for UI that wants to react without owning the recovery policy.

## Where to go next

- [Scene graph](/guides/scene) for nodes, behaviors, transforms, render layers.
- [Drawing](/guides/drawing) for the `Gfx2D` facade and custom `draw` methods.
- [Camera](/guides/camera) for viewport framing and `animateTo`.
- [Input](/guides/input) for pointer capture and hit testing.
- [Animation](/guides/animation) for tweens, timelines, and the abort contract.
- [Stages](/guides/stages) to render a second canvas on the same clock.

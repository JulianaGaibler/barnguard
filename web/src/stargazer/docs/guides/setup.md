# Engine setup

This walks through standing up the engine from an empty canvas: what the host
is, how to mount it, the options worth knowing, the lifecycle calls, and how to
reach the subsystems once it runs. The [Getting started](/) snippet on the
README is the 30-second version; this is the fuller picture.

## Host and engine

Two objects sit at the top. The `Engine` owns the frame loop and the
per-canvas services (scene, camera, input, animation, renderer). The
`EngineHost` wraps one engine and owns the concerns a page needs around it:
start and stop, pause and resume, scene swapping, and WebGL context-loss
recovery. You build a host, and reach the engine through `host.engine`.

Mount one host per canvas. In a Svelte component, use the `mountEngine` action;
everywhere else, call `createEngineHost` by hand.

## Mounting in Svelte

`mountEngine` is a `<canvas>` action. It constructs the host from the element,
runs your `onReady`, and calls `host.destroy()` when the component unmounts, so
teardown is tied to the component lifecycle and you write no `onDestroy`
boilerplate.

```svelte
<script lang="ts">
  import { mountEngine, ShapeNode } from '@src/stargazer'
  import type { EngineHost } from '@src/stargazer'

  async function onReady(host: EngineHost): Promise<void> {
    await host.loadScene((scene) => {
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
    options: {
      clearColor: '#0d1a2c',
      initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
    },
    onReady,
  }}
></canvas>
```

The action supplies `canvas` from the element, so `options` is
`EngineHostOptions` without it. Keep the host reference from `onReady` if you
need to call `pause`, `loadScene`, or the debug controller later.

## Mounting by hand

Without Svelte, pass the canvas yourself and manage the lifecycle:

```ts
import { createEngineHost, ShapeNode } from '@src/stargazer'

const canvas = document.querySelector('canvas')!
const host = createEngineHost({
  canvas,
  clearColor: '#0d1a2c',
  initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },
})

await host.loadScene((scene) => {
  scene.root.add(
    new ShapeNode({ geometry: { kind: 'circle', radius: 40 }, fill: '#fff' }),
  )
})

host.start()

// When the page is done with it:
host.destroy()
```

The engine sizes itself to the canvas through a `ResizeObserver`, so you don't
set pixel dimensions. Give the canvas a CSS size and the backing store follows,
device-pixel ratio included.

## Options worth knowing

Everything has a default, so pass only what you change. The common ones:

```ts
const host = createEngineHost({
  canvas,
  // Frame clear. Omit both for an opaque black clear.
  clearColor: '#0d1a2c',
  transparent: false, // true clears with clearRect so the CSS background shows through

  // The world rect the camera frames on boot. Default 1920×1080.
  initialViewport: { x: 0, y: 0, width: 1920, height: 1080 },

  // Timing.
  fixedStepHz: 120, // deterministic fixed-step rate (physics, onFixedStep)
  maxFps: 0, // render cap; 0 is uncapped
  maxDt: 1 / 30, // clamp on a single frame's dt after a stall

  // Rendering.
  renderer: 'auto', // 'gpu' | 'canvas2d' | 'auto' (auto = GPU unless ?renderer=canvas2d)
  msaaSamples: 4, // GPU only; 0 disables

  // Opt-in physics on the primary stage. Off by default.
  physics: { gravity: { x: 0, y: 900 } },

  // Debug HUD initial state. Absent reads ?debug from the URL.
  debug: 'hidden', // 'hidden' | 'hud' | 'perf'
})
```

`renderer`, `msaaSamples`, and `debug` each resolve from the option first, then
fall back to a URL flag (`?renderer=`, `?msaa=`, `?debug=`), so a deployed build
can be probed without a code change. Pass the option explicitly to ignore the
URL. See [Physics](/guides/physics) for the physics config, and
[Scene graph](/guides/scene#dynamic-resolution) for `dynamicResolution`.

## Lifecycle

```ts
host.start() // begin the render loop; the first call emits `ready`
host.stop() // halt the loop; scene and GL resources stay intact
host.pause() // stop the ticker for a full-screen overlay
host.resume() // undo pause()
host.destroy() // tear down: stop, drop listeners, reject pending tweens
await host.loadScene(build) // swap the scene (see below)
```

`host.pause()` stops the ticker outright, for when a menu or modal covers the
whole canvas and there's no reason to keep drawing. It differs from
`engine.setPaused(true)`, a soft freeze that keeps the ticker running so debug
tooling stays live while game updates halt. Reach for the host's `pause` for an
overlay, the engine's `setPaused` for a debug-style freeze.

## Building the scene

`loadScene` destroys the current root's children, then calls your builder to
populate the empty scene. The builder receives the scene and the engine, and may
be async, so it can await asset loads before it adds nodes:

```ts
await host.loadScene(async (scene, engine) => {
  const svg = await fetch('/map.svg').then((r) => r.text())
  const paths = await parseSvgPaths(svg)

  const bg = new ShapeNode({
    geometry: { kind: 'rect', width: 1920, height: 1080, centered: false },
    fill: '#12233f',
  })
  bg.renderLayer = 'static' // baked once, blitted each frame
  scene.root.add(bg)

  // ...build the rest of the tree from `paths`
})
```

An `AssetLoader` (a keyed async cache) keeps a one-time fetch-and-parse cost from
repeating across scene reloads; construct one and `await loader.load(key, ...)`
inside the builder.

Call `loadScene` again to swap scenes; the previous tree is destroyed for you,
which aborts its in-flight tweens and detaches its behaviors. See
[Scene graph](/guides/scene) for the node types and the render layers.

## Reaching the subsystems

Everything hangs off `host.engine`:

```ts
const engine = host.engine

engine.scene // the primary Scene; engine.scene.root is where nodes go
engine.camera // the game Camera (viewport, animateTo)
engine.input // the primary InputSystem (pointers, touch slop)
engine.animation // the Animator behind tween / wait
engine.renderer // pixel size, render scale
engine.dom // HTML-overlay sync (see HTML overlays)
engine.physics // the primary stage's PhysicsWorld, or null if off
```

The engine also forwards the tween helpers so you don't reach into `animation`
for the common case:

```ts
await engine.tween(node.transform, { x: 400 }, { duration: 0.5 })
await engine.wait(0.2)
await engine.animate(node, { alpha: 0 }, { duration: 0.3 }) // scoped to node.abortSignal
```

## Reacting to engine events

The host exposes the engine's event bus as `host.events`. Discrete events
(`ready`, `resize`, `contextlost`, `contextrestored`, `destroyed`, and the
primary-canvas pointer events) are fine to subscribe to directly:

```ts
const off = host.events.on('resize', ({ css, dpr }) => {
  console.log('canvas is now', css.w, '×', css.h, 'at dpr', dpr)
})
// off() to unsubscribe
```

The `frame` and `pointerMove` events fire many times per second. Don't bind
those to a Svelte store; read them in a `$effect` with `emitter.on(...)`
instead. In Svelte, `emitterStore` and `latestEventStore` turn a discrete event
into a `Readable` and warn if you point them at a high-frequency key. See
[Architecture](/guides/architecture#the-svelte-boundary).

## Context loss

A WebGL context can vanish (GPU reset, tab backgrounded, driver hiccup). The
host listens for it and runs a retry ladder: it rebuilds GL resources when the
context comes back, and gives up only after repeated losses in a short window or
when the browser signals the loss is permanent. The default action on giving up
is a page reload.

Override that when a reload isn't wanted:

```ts
const host = createEngineHost({
  canvas,
  onContextLost: (restorable) => {
    // Called the moment the context drops. Show a "reconnecting" state, say.
  },
  onReload: () => {
    // Called when the retry ladder gives up. Rebuild in place instead of
    // reloading the page.
  },
})
```

The `contextlost` and `contextrestored` engine events fire alongside these, for
UI that wants to react without owning the recovery policy.

## Where to go next

- [Scene graph](/guides/scene) for nodes, behaviors, transforms, render layers.
- [Camera](/guides/camera) for the viewport fit and `animateTo`.
- [Input](/guides/input) for pointer capture and hit testing.
- [Animation](/guides/animation) for tweens, timelines, and the abort contract.
- [Stages](/guides/stages) to render a second canvas on the same clock.

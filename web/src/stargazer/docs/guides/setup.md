---
title: Engine setup
group: Getting started
order: 1
---

# Engine setup

An {@link EngineHost} puts the engine on a `<canvas>`. It wraps one {@link Engine}, which owns the frame loop and the services for that canvas: the scene tree, cameras, input, animation and the renderer. The host adds what a page needs around the engine: start and stop, pause and resume, scene swapping, and recovery when the graphics context is lost.

Mount one host per canvas. In a Svelte component, use the {@link mountEngine} action. Anywhere else, call {@link createEngineHost}. Either way you add a camera to the scene yourself.

## Basic usage

This Svelte component mounts the engine, builds a scene with a camera and one circle, and starts the loop.

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

The canvas shows a yellow circle at the world origin, which is the top-left corner of the 1920 by 1080 viewport. The action picks a rendering backend, builds the host from the element, and calls `onReady`. When the component unmounts, the action calls `host.destroy()`, so you don't write an `onDestroy` for it.

`options` takes every {@link EngineHostOptions} field except `canvas`, which the action supplies. Keep the host from `onReady` if you need it later, for example to pause or to load another scene.

### Add a camera

The engine doesn't create a camera. Until a {@link CameraNode2D} is in the tree, `engine.currentCamera2D` is `null` and the stage draws only the clear color. A blank canvas on the first run usually means the camera is missing.

The first camera added to a stage becomes current. [`makeCurrent`](/module/camera/cameranode2d#makecurrent) switches to another one. [`loadScene`](/module/engine/enginehost#loadscene) destroys the cameras of the previous scene with the rest of its nodes, so each scene builder adds its own. See [Camera](/guides/camera) for framing and zoom.

### Mount without Svelte

Outside Svelte, pass the canvas to {@link createEngineHost} and call `destroy` yourself.

```ts
import { createEngineHost, CameraNode2D } from '@src/stargazer'

const canvas = document.querySelector('canvas')!
const host = createEngineHost({ canvas, clearColor: '#0d1a2c' })

await host.loadScene((scene) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)
})

host.start()

// When the page no longer needs the engine:
host.destroy()
```

`createEngineHost` on its own always renders with WebGL2. To use WebGPU, see [Pick a backend](#pick-a-backend).

The engine sizes the canvas backing store from the canvas's CSS size and the device pixel ratio. It watches the canvas with a `ResizeObserver` and listens for `window` resize, so you only give the canvas a CSS size.

### Build and swap scenes

`loadScene` destroys every child of the scene root, then calls your builder with the empty scene and the engine. The builder can be async, so it can wait for assets before it adds nodes.

```ts
import { CameraNode2D, Path2DNode, parseSvgPaths } from '@src/stargazer'

await host.loadScene(async (scene, engine) => {
  const cam = new CameraNode2D()
  cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
  scene.root.add(cam)

  const svg = await fetch('/board.svg').then((r) => r.text())
  const { paths } = parseSvgPaths(svg, { tessellate: true })
  for (const [id, entry] of paths) {
    scene.root.add(new Path2DNode({ id, path: entry.path, fill: '#12233f' }))
  }
})
```

Call `loadScene` again to swap scenes. Destroying the old nodes aborts their node-scoped work: tweens started with `node.tween` or `engine.animate` reject with `AbortError`, and behaviors detach. To avoid fetching and parsing the same file again on every scene load, keep the result in an {@link AssetLoader}. See [Assets](/guides/assets).

### Start, stop and pause

The host has these lifecycle calls:

```ts
host.start() // start the frame loop, the first call emits `ready`
host.stop() // stop the loop, the scene and GPU resources stay
host.pause() // stop the loop while an overlay covers the canvas
host.resume() // undo pause()
host.destroy() // stop, remove listeners, reject pending tweens, free the GPU
```

`host.pause()` stops the loop. Use it when a menu or modal covers the whole canvas. [`engine.setPaused(true)`](/module/engine/engine#setpaused) is a soft freeze: the loop keeps running and the stages keep rendering, but tweens, `onUpdate`, `onFixedStep` and physics stop. The debug camera stays usable during a soft freeze.

## Advanced usage

This section covers backend choice, the engine options, reaching the subsystems, engine events, automatic quality reduction and context loss.

### Pick a backend

`mountEngine` takes a `backend` parameter. `'auto'` (the default) checks that WebGPU works on the machine and falls back to WebGL2. `'webgpu'` and `'webgl2'` force one, and forcing WebGPU fails when it isn't available.

```svelte
<canvas use:mountEngine={{ backend: 'webgl2', onReady }}></canvas>
```

A canvas keeps the context type it gets first, so the choice is made once, before the host exists. With `'webgl2'` the action builds the host right away. With `'auto'` and `'webgpu'` it builds the host after an async check, so `onReady` runs later.

Outside Svelte, call {@link selectGfxDevice} first and pass the device to the host:

```ts
import { selectGfxDevice, createEngineHost } from '@src/stargazer'

const { device, backend } = await selectGfxDevice(canvas, 'auto')
console.info('rendering backend:', backend)
const host = createEngineHost({ canvas, gpuDevice: device })
```

### Engine options

Every option has a default, so pass only what you change.

| Option           | Default     | Meaning                                                                                                                         |
| ---------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `clearColor`     | `'#0d1a2c'` | Color the frame is cleared to. Ignored when `transparent` is set.                                                               |
| `transparent`    | `false`     | Clear to zero alpha, so the page behind the canvas shows.                                                                       |
| `fixedStepHz`    | `120`       | Rate of the fixed step that runs physics and `onFixedStep`.                                                                     |
| `maxFps`         | `0`         | Frame rate cap in Hz. `0` renders at the display rate.                                                                          |
| `maxDt`          | `1 / 30`    | Largest frame `dt` in seconds, so a stall doesn't jump the simulation.                                                          |
| `smoothTimestep` | `true`      | Smooth `dt` to remove timer jitter. A real change in frame time passes through at once.                                         |
| `msaaSamples`    | `4`         | Multisample count. `0` or `1` turns it off. Secondary stages use the same count.                                                |
| `directPresent`  | `true`      | Draw in the canvas format, so the last pass writes the canvas with no copy. `false` draws into a separate target and copies it. |
| `renderScale`    | `1`         | Factor on the device pixel ratio, from `0.1` to `2`. See [Stages](/guides/stages).                                              |
| `physics`        | off         | `true` or a config gives the primary stage a {@link PhysicsWorld}. See [Physics](/guides/physics).                              |
| `quality`        |             | Starting 3D quality settings, including `adaptive`. See [3D](/guides/3d).                                                       |
| `fog`            | off         | Starting 3D fog settings. See [3D](/guides/3d).                                                                                 |
| `debug`          | from URL    | Debug HUD at start: `'hidden'`, `'hud'` or `'perf'`.                                                                            |
| `qualityProfile` | `true`      | Apply the quality settings saved in the debug panel for this screen.                                                            |

`msaaSamples` and `debug` fall back to URL flags when you don't pass them: `?msaa=N` and `?debug=hud` or `?debug=perf`. This lets you test a deployed build without changing code. Pass the option to ignore the URL. `?quality=off` ignores the saved quality settings, and `?quality=reset` deletes them. See [Debugging](/guides/debugging) for the HUD.

### Reach the subsystems

The engine is at `host.engine`. These are its main properties:

```ts
const engine = host.engine

engine.tree // the primary stage's scene tree, add nodes under tree.root
engine.currentCamera2D // the current 2D camera, or null
engine.input // the primary stage's InputSystem
engine.animation // the Animator that runs every tween and wait
engine.renderer // canvas size in CSS and device pixels, and the pixel ratio
engine.dom // HTML elements that follow scene nodes
engine.a11y // the hidden accessibility tree
engine.postProcess // screen-space effects on the primary stage
engine.physics // the primary stage's PhysicsWorld, or null
engine.qualityControl // hold quality settings at fixed values
```

`dom`, `a11y` and `postProcess` are created the first time you read them. See [HTML overlays](/guides/html-overlays), [Accessibility](/guides/accessibility) and [Post-processing](/guides/post-processing).

The engine also has tween helpers, so the common cases don't need `engine.animation`:

```ts
await engine.tween(node.transform, { x: 400 }, { duration: 0.5 })
await engine.wait(0.2)
await engine.animate(node, { alpha: 0 }, { duration: 0.3 }) // ends if node is destroyed
```

See [Animation](/guides/animation).

### Engine events

`host.events` is the engine's {@link Emitter}. {@link EngineEvents} lists every event. `on` returns a function that removes the listener.

```ts
const off = host.events.on('resize', ({ css, dpr }) => {
  console.log('canvas is now', css.w, 'x', css.h, 'at dpr', dpr)
})
off()
```

`frame` and `pointerMove` fire many times per second. In Svelte, don't turn them into stores. Subscribe with `host.events.on` inside a `$effect`. {@link emitterStore} and {@link latestEventStore} turn other events into Svelte stores, and they log a warning when given `frame` or `pointerMove`. See [Architecture](/guides/architecture).

### Automatic quality reduction

On a slow GPU the engine lowers the primary stage's quality on its own. It measures the frame interval and the CPU time of each frame over about 1.5 seconds. When the median interval is above 37 ms and the CPU time is under half of it, the GPU is the bottleneck, and the engine lowers one setting by one step.

The steps come in this order:

1. Ambient occlusion at half resolution.
2. MSAA from 4x to 2x.
3. Ambient occlusion preset `low`.
4. MSAA to 1x.
5. Shadow softness to 4 taps.
6. Render scale 0.85, then 0.75.
7. Shadow softness to 1 tap.
8. Render scale 0.6.
9. Ambient occlusion off, then shadows off.
10. Render scale 0.5.

The engine skips a step that would change nothing. A 2D scene only goes through MSAA and render scale. WebGPU has no 2x MSAA, so it goes from 4x to 1x. A setting that is already lower stays where it is. With a frame cap, a frame counts as slow only when it takes longer than 1.3 times the cap's interval.

When the median is above 74 ms, the engine takes half of the remaining steps at once. After each change it waits one second before it measures again. It never raises quality again, because each change rebuilds a render target.

Each change is logged to the console and emitted as `qualitychange` on `host.events`, with the new settings and the steps taken. To turn this off, pass `quality: { adaptive: false }`. To keep one setting at a value, hold it with {@link QualityControl}, for example `engine.qualityControl.setFixed('msaa', 2)`. The debug HUD's Quality panel uses the same controls.

### Context loss

The browser can take the graphics context away, for example after a GPU reset. The two backends recover differently, and the host handles both.

A lost WebGL2 context can come back. The host emits `contextlost` and waits. When the context returns, the host rebuilds the GPU resources and emits `contextrestored`. The host gives up after three losses within 60 seconds, or when the browser says the context won't come back. It then calls `onContextLost(restorable)` if you passed it, or else `onReload`, which reloads the page by default.

A lost WebGPU device can't come back, and the canvas can't switch to another context type. The host emits `contextlost` and `backendlost`, then calls `onBackendLost`. Without one it calls `onReload`. To recover without a reload, the component that owns the canvas remounts on a new canvas with `backend: 'webgl2'`.

```ts
const host = createEngineHost({
  canvas,
  onContextLost: (restorable) => {
    // WebGL2 recovery gave up. Rebuild the engine instead of reloading.
  },
  onBackendLost: () => {
    // WebGPU is gone. Remount on a new canvas with WebGL2.
  },
})
```

`mountEngine` also takes `onBackendLost` as a parameter.

### Render failures

A shader that the browser rejects doesn't stop the engine. The program that needs it draws nothing, and everything else keeps rendering. The engine emits `renderfailure` with the `source` and the compiler's `message`, once per failure. The debug HUD's Rendering panel lists the same failures.

An error thrown while a stage renders stops that stage. It logs the error once and draws no more frames. [`stage.faulted`](/module/render/stage#faulted) is then `true`.

## See also

- {@link EngineHost}: the lifecycle wrapper around one engine
- {@link createEngineHost}: builds a host for a canvas
- {@link mountEngine}: Svelte action that mounts a host
- {@link EngineHostOptions}: every host option
- {@link Engine}: the frame loop and the subsystems
- {@link selectGfxDevice}: picks the WebGPU or WebGL2 backend
- [Architecture](/guides/architecture): how the engine runs a frame
- [Scene graph](/guides/scene): nodes, behaviors and transforms
- [Camera](/guides/camera): viewport framing and zoom
- [Stages](/guides/stages): more canvases on the same clock
- [Debugging](/guides/debugging): the HUD and its panels
- [Getting started](/): the short version in the README

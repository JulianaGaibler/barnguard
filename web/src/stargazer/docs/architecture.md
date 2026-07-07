# Architecture

## The main loop

`Engine.frame(dt)` runs every browser `requestAnimationFrame`. `dt` is the raw frame delta, clamped to `1/30 s` so a stalled tab doesn't fling anything across the map.

```
1. onBeforeFrame handlers       subsystems that MOVE the camera
2. input.beforeFrame()          reproject pointer world coords, emit synthetic moves
3. animation.tick(dt)           advance tweens and waits
4. update pass                  walk each stage's tree, call node.onUpdate + behaviour.onUpdate
5. transform propagation        each stage: DFS, compose parent × local into node.transform.world
6. render                       each stage: static blit, above-static, dynamic (primary also gets debug overlay)
7. events.emit('frame', ...)    external observers, once per frame
```

The order matters. Camera-moving subsystems run before input reprojection, so a `WASD`-panning debug camera doesn't drag the pointer state behind by one frame. Input reprojection runs before the update pass, so behaviours read fresh pointer world coords.

`Ticker` also runs a fixed inner step at 120 Hz (configurable via `EngineHostOptions.fixedStepHz`). Behaviours can subscribe via `Behaviour.onFixedStep` for anything that needs determinism such as collision detection or packet motion. The fixed step runs between rAF frames and consumes an accumulator, capped at 8 steps per frame so a huge dt after a stall doesn't spiral. Fixed-step is primary-only. Secondary stages don't participate.

## Rendering backends

Nodes draw through the `Gfx2D` facade. Two implementations sit behind it.

- **`GpuGfx`** (WebGL2). Default. Batches into five programs (colored-tri, textured-quad, stroke, SDF, radial gradient), MSAA on an offscreen FBO, bitmap-mask clipping. `?msaa=N` picks the sample count (default 4, clamped to the driver's `MAX_SAMPLES`).
- **`Canvas2DGfx`**. Visual parity oracle, tutorial mini-stage fallback (avoids the ~20 ms WebGL2 context-acquire spike at state-tap), and the `?renderer=canvas2d` opt-out.

Node code never sees which backend is live. Cross-cutting facade rules (per-call styles, absolute alpha, pre-resolved stroke widths) are documented on the `Gfx2D` interface itself.

The debug HUD's GPU section exposes render modes (`polygons`, `overdraw`, `batch-color`, `clip-mask`) and a live MSAA switch when the backend is GPU. Mode semantics live on `DebugRenderMode` in `src/stargazer/render/gfx/GpuGfx.ts`.

## World coords, DPR, and the camera

There are three coordinate spaces:

- **World**. Game-side coords, independent of pixels or DPR. This is what `SceneNode.transform.x/y` uses and what `node.hitTest(worldX, worldY, ...)` sees.
- **Screen (CSS px)**. Position on the visible canvas element. The `InputSystem` gets these from `event.clientX - rect.left`, and the Camera converts between screen and world via `worldToScreen` / `screenToWorld`.
- **Device px**. Physical pixels on the display. The `Renderer` multiplies by `window.devicePixelRatio` and applies that as the baseline transform. Game code never sees device px.

The `Camera` fits its world `viewport` rect into the canvas at a uniform scale. Whatever canvas area lies outside the fitted world region shows the clear color. No letterbox bars, no distortion; if the canvas aspect doesn't match the world viewport, there's extra clear-color space on the sides or the top/bottom. Resizing the canvas reflows automatically.

`Camera.animateTo(target, opts)` tweens the viewport rect through the engine's `Animator`. See [`camera.md`](./camera.md).

## Stages

A `Stage` bundles the things that vary per canvas, `Renderer`, `Scene`, `Camera`, `Layers`, its own `ResizeObserver`, and the render pipeline that targets it. The `Engine` owns a `primaryStage` for its own canvas; `engine.renderer` / `engine.scene` / `engine.camera` / `engine.layers` are getters onto that primary stage.

Additional stages attach via `engine.attachStage(canvas, opts)` and detach via `engine.detachStage(stage)`. Each stage has its own scene tree, its own camera, and its own static-layer cache, nothing bleeds between stages.

What secondary stages share with the primary:

- **The `Ticker`.** One rAF loop drives every stage. Tweens on secondary-scene nodes stay perfectly in sync with primary tweens, same wall clock, same `dt`.
- **The `Animator`.** Tweens on any stage's nodes tick from the shared pool; `engine.animation.cancelAll()` catches them all.
- **The pause flag.** `engine.setPaused(true)` freezes every stage's update pass at once.

What secondaries do NOT get:

- **No `InputSystem`.** Only the primary canvas receives pointer events. Secondaries are display-only.
- **No debug overlay.** Grid, node outlines, pointer overlay, and the debug camera all target the primary canvas.
- **No `onFixedStep`.** Fixed-step iteration runs only on the primary scene.
- **No `contextlost` auto-reload.** The kiosk-safe reload is primary-only; a secondary can recover in place via `stage.reacquireContext()`, or the app can just detach and re-attach.

More detail in [`stages.md`](./stages.md), including the `mountStage` Svelte action.

## The scene graph

`Scene` owns a root `SceneNode`. Every renderable is a subclass of `SceneNode` (`ShapeNode`, `Path2DNode`, `PolylineNode`, `ParticleEmitterNode`, `GroupNode`). Nodes compose spatially through their `transform`, parent world matrix × child local matrix.

`Behaviour` objects are the way game logic attaches to nodes. A Behaviour has optional `onAttach`, `onDetach`, `onUpdate(dt)`, and `onFixedStep(fixedDt)` hooks. Multiple behaviours can share a node; `node.getBehaviour<T>(Ctor)` and `getBehaviours<T>(Ctor)` look them up by class.

Every node has its own `AbortController`. `node.destroy()` aborts the signal before recursing into children, so any pending `node.tween(...)`, `node.wait(...)`, or `node.animate(...)` promises reject with `AbortError` and clean up their state. See [`animation.md`](./animation.md).

Details in [`scene.md`](./scene.md).

## Render layers

Each `SceneNode` has a `renderLayer`:

- `'static'`, baked once to an offscreen canvas, blitted every frame. For the Germany map.
- `'above-static'`, drawn per frame between the static blit and the dynamic pass. The promotion target for a state that's temporarily animating (shockwave pulse).
- `'dynamic'` (default), drawn per frame on top of everything else. Packets, particles, path trails.

Setting `node.renderLayer` to or from `'static'` calls `scene.invalidateStatic()`. The next stable-camera frame re-bakes the offscreen. Setting `renderLayer` between `'above-static'` and `'dynamic'` costs nothing, those layers are drawn every frame anyway.

The renderer skips the cache when the camera moved this frame (a running `animateTo`, or a debug camera pan) and draws the static tree fresh directly to the main canvas. It bakes again on the first stable frame. Result: 0 bakes/second in steady state, one bake on each camera settle, exactly 2 bakes across a full promote → tween → demote pulse.

More detail on the invalidation contract and how to avoid stale bakes in [`scene.md`](./scene.md#render-layers-and-the-static-bake).

## The Svelte boundary

`EngineHost` is the only surface Svelte code should touch. Commands go in (`start`, `stop`, `pause`, `resume`, `destroy`, `loadScene`); engine events come out on `host.events: Emitter<EngineEvents>` (`ready`, `frame`, `resize`, `pointerDown/Move/Up/Cancel`, `contextlost`, `contextrestored`, `destroyed`).

Game code owns its own `Emitter<GameEvents>`, the engine never learns about `stateSelected` or `gameOver`. See `src/game/index.ts` for the pattern.

Two Svelte helpers:

- `mountEngine`, a Svelte action for `<canvas>` that constructs the host, forwards resize, and destroys on unmount.
- `emitterStore(emitter, key, initial)` / `latestEventStore(emitter, key)`. Readable stores backed by emitter subscriptions. Both warn if you bind them to `'frame'` or `'pointerMove'` because those fire ~120 times per second and thrash Svelte's reactivity graph. Use direct `.on(...)` in a `$effect` for high-frequency events; save the stores for discrete events like `stateSelected`, `gameOver`, `score`.

## Where things do not go

- Game rules, packet spawn logic, scoring, collision rules. Under `src/game/`.
- Text on canvas. DOM overlays positioned by `camera.worldToScreen(...)`, styled with the shared typography classes from `src/styles/typography.scss`.
- Audio, physics libraries. Not shipped. If you need them, add them to the game layer, not the engine.
- Hooking Svelte stores to `frame` or `pointerMove`. The `emitterStore` dev warn is there for a reason.

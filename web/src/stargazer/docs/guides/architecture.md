# Architecture

## The main loop

`Engine.frame(dt)` runs on every browser `requestAnimationFrame`. `dt` is the raw frame delta, clamped to `1/30 s` so a stalled tab can't launch objects across the world on the next frame.

```
1. onBeforeFrame handlers    subsystems that move the camera
2. input.beforeFrame()       reproject pointer world coords, emit synthetic moves
3. animation.tick(dt)        advance tweens and waits
4. update pass               walk each stage's tree, call node + behavior onUpdate
5. transform propagation     each stage: DFS, compose parent × local into world
6. render                    each stage: static blit, above-static, dynamic
7. events.emit('frame', ...) external observers, once per frame
```

The order matters. Camera-moving subsystems run before input reprojection, so a panning debug camera doesn't drag the pointer state behind by a frame. Input reprojection runs before the update pass, so behaviors read fresh pointer world coords.

That first step is a hook. Anything that moves the camera each frame registers there, so its motion is folded in before pointers reproject:

```ts
const off = engine.onBeforeFrame((dt) => {
  // e.g. ease the camera toward a follow target
  followCamera(dt)
})
// off() to unregister
```

`Ticker` also runs a fixed inner step (120 Hz by default, set via `EngineHostOptions.fixedStepHz`). Behaviors subscribe through `Behavior.onFixedStep` for anything that needs determinism, such as collision or physics integration. The fixed step consumes a time accumulator between rAF frames, capped per frame so a large `dt` after a stall can't spiral. It runs on the primary stage only; secondary stages don't participate.

## Rendering

Nodes draw through the `Gfx2D` facade, so node code never sees which backend is live. The backend is WebGL2 (`GpuGfx`): batched draw programs, MSAA, and bitmap-mask clipping. `?msaa=N` picks the sample count, clamped to the driver's `MAX_SAMPLES`.

`Canvas2DGfx` is a second implementation of the same facade, used as a visual-parity oracle when debugging a rendering difference and as a fallback. Reach it with `?renderer=canvas2d`. Treat it as a comparison tool, not the target; the GPU backend is what the engine is built around.

Cross-cutting facade rules (per-call styles, absolute alpha, pre-resolved stroke widths) are documented on the `Gfx2D` interface.

## World coords, DPR, and the camera

There are three coordinate spaces:

- **World.** Game-side coords, independent of pixels or DPR. This is what `SceneNode.transform.x/y` uses and what `node.hitTest(worldX, worldY, ...)` sees.
- **Screen (CSS px).** Position on the visible canvas element. `InputSystem` reads these from the pointer event, and the camera converts between screen and world via `worldToScreen` / `screenToWorld`.
- **Device px.** Physical pixels. `Renderer` multiplies by `devicePixelRatio` and applies that as the baseline transform. Game code never sees device px.

`Camera` fits its world `viewport` rect into the canvas at a uniform scale. Canvas area outside the fitted region shows the clear color, so there are no letterbox bars and no distortion; when the canvas aspect doesn't match the viewport, the extra space sits on the sides or the top and bottom. Resizing reflows automatically.

Convert between the two spaces through the camera. Game code that reads a DOM pointer coord maps it to world; code that positions an HTML element maps the other way:

```ts
const world = engine.camera.screenToWorld(cssX, cssY) // CSS px → world
const screen = engine.camera.worldToScreen(node.transform.x, node.transform.y) // world → CSS px
```

Both take an optional `out: Vec2` to avoid allocating in a per-frame loop.

`Camera.animateTo(target, opts)` tweens the viewport rect through the engine's `Animator`. See [Camera](/guides/camera).

## Stages

A `Stage` bundles what varies per canvas: `Renderer`, `Scene`, `Camera`, `Layers`, a `ResizeObserver`, and the render pipeline that targets it. `Engine` owns a `primaryStage`; `engine.renderer` / `engine.scene` / `engine.camera` / `engine.layers` are getters onto it.

More stages attach via `engine.attachStage(canvas, opts)` and detach via `engine.detachStage(stage)`. Each has its own scene tree, camera, and static-layer cache; nothing bleeds between stages.

Secondary stages share the `Ticker` (one rAF loop drives every stage), the `Animator` (`engine.animation.cancelAll()` catches tweens on any stage), and the pause flag (`engine.setPaused(true)` freezes every update pass at once). They do not get an `InputSystem` unless constructed with `interactive: true`, and `onFixedStep` runs on the primary scene only. See [Stages](/guides/stages).

## The scene graph

`Scene` owns a root `SceneNode`. Every renderable is a `SceneNode` subclass (`ShapeNode`, `Path2DNode`, `PolylineNode`, `TextNode`, `ParticleEmitterNode`, `SceneNode`). Nodes compose spatially through their `transform` as parent world matrix × child local matrix.

`Behavior` objects attach game logic to nodes, with optional `onAttach`, `onDetach`, `onUpdate(dt)`, and `onFixedStep(fixedDt)` hooks. Multiple behaviors can share a node; `node.getBehavior<T>(Ctor)` and `getBehaviors<T>(Ctor)` look them up by class.

Every node owns an `AbortController`. `node.destroy()` aborts the signal before recursing into children, so pending `node.tween(...)`, `node.wait(...)`, and `node.animate(...)` promises reject with `AbortError` and clean up. See [Animation](/guides/animation).

Details in [Scene graph](/guides/scene).

## Render layers

Each `SceneNode` has a `renderLayer`:

- `'static'`, baked once to an offscreen buffer and blitted every frame. Use it for content that changes rarely, such as a background or a map.
- `'above-static'`, drawn per frame between the static blit and the dynamic pass. The place to promote a static node that is temporarily animating.
- `'dynamic'` (default), drawn per frame on top.

Setting `renderLayer` to or from `'static'` calls `scene.invalidateStatic()`, and the next stable-camera frame re-bakes. Moving a node between `'above-static'` and `'dynamic'` costs nothing, since both draw every frame.

The renderer bypasses the static cache on any frame where the camera moved (a running `animateTo`, or a debug-camera pan) and draws the static tree fresh, then bakes again on the first settled frame. In steady state that means no bakes per second, one bake per camera settle. See [Scene graph](/guides/scene#render-layers-and-the-static-bake).

## The Svelte boundary

`EngineHost` is the only surface Svelte code should touch. Commands go in (`start`, `stop`, `pause`, `resume`, `destroy`, `loadScene`); engine events come out on `host.events: Emitter<EngineEvents>` (`ready`, `frame`, `resize`, `pointerDown/Move/Up/Cancel`, `contextlost`, `contextrestored`, `destroyed`).

Game code owns its own `Emitter` for game events; the engine never learns about them. Two Svelte helpers bridge the gap:

- `mountEngine`, a `<canvas>` action that constructs the host, forwards resize, and destroys on unmount.
- `emitterStore(emitter, key, initial)` / `latestEventStore(emitter, key)`, readable stores backed by emitter subscriptions. Both warn if you bind them to `'frame'` or `'pointerMove'`, which fire many times per second and thrash Svelte's reactivity graph. Use direct `.on(...)` in a `$effect` for high-frequency events; reserve the stores for discrete events.

A discrete game event is fine as a store; a per-frame value is read directly:

```ts
// Discrete: a score that changes a few times a second.
const score = emitterStore(game.events, 'score', 0) // {$score} in markup

// High frequency: read it in an effect, don't route it through reactivity.
$effect(() => host.events.on('frame', ({ dt }) => updateFpsMeter(dt)))
```

## Where things don't go

- Game rules: spawning, scoring, collision logic. These live in your game layer.
- Audio and physics libraries. Add them to the game layer if you need them.
- Binding Svelte stores to `frame` or `pointerMove`. The `emitterStore` warning is there for a reason.

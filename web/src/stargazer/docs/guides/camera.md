# Camera

`Camera` describes a rectangular window into world coords. The renderer fits that window into the canvas at a uniform scale (aspect-preserving `contain`), so there's no distortion and no letterbox bars; extra canvas area shows the clear color.

## Viewport, pixel size, and the screen transform

```ts
class Camera {
  viewport: Rect // world-space rect
  pixelSize: { w: number; h: number } // canvas CSS px

  worldToScreen(x, y, out?): Vec2 // world → CSS px
  screenToWorld(x, y, out?): Vec2 // CSS px → world
  screenPxPerWorldUnit(): number // uniform scale
  getScreenTransform(out?): ScreenTransform // { scale, offsetX, offsetY }
  animateTo(target, opts?): Promise<void>
  readonly frameNum: number // increments on viewport / pixel-size changes
}
```

The engine keeps `pixelSize` in sync with the canvas element on every `ResizeObserver` fire and on `window.resize`. Game code doesn't set it.

`getScreenTransform()` gives the three numbers the renderer uses (`scale`, `offsetX`, `offsetY`), all in CSS px; DPR is applied separately as the context baseline.

For most game code you want `worldToScreen` or `screenToWorld`. Both accept an optional `out: Vec2` to avoid allocating.

## The uniform fit

For a viewport of `W × H` world units in a canvas of `Cw × Ch` CSS px, the fit scale is `min(Cw / W, Ch / H)`. The viewport renders centered, and the leftover space on the wider axis shows the clear color.

Change the canvas size, or set `camera.viewport` to a smaller world rect, and the scale grows to match. Circles stay circular, rects stay rectangular, and touch slop stays the same physical size on screen.

## animateTo

Tween the viewport rect from its current value to a target:

```ts
import { easings } from '@src/stargazer'

await engine.camera.animateTo(
  { x: 0, y: 380, width: 661, height: 520 },
  { duration: 0.5, easing: easings.inOutQuad },
)
```

`opts` accepts `duration` (default 0.5 s), `delay`, `easing`, and `signal`. The returned promise resolves when the tween settles, or rejects with `AbortError` on abort.

Under the hood it tweens a scratch rect through the engine's `Animator` and calls `camera.setViewport(...)` each tick, so `frameNum` increments and the renderer bypasses the static-layer cache during the tween.

Aborting one `animateTo` doesn't cancel another you start right after. Hold your own `AbortController`, abort it before starting a new tween, and pass the new signal:

```ts
let controller: AbortController | null = null

async function zoomTo(rect: Rect): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  await engine.camera
    .animateTo(rect, { duration: 0.5, signal: controller.signal })
    .catch(ignoreAbort)
}
```

## Stroke space scale

`camera.strokeSpaceScale()` returns the multiplier a node's `draw` applies to a CSS-pixel `lineWidth` so the stroke stays visually constant across camera zoom. It's `1 / screenPxPerWorldUnit()` once the camera is initialized, and `1` while the pixel size is still `0` (fresh construction, before the first resize).

The engine primitives (`ShapeNode`, `Path2DNode`, `PolylineNode`) apply it automatically whenever `strokeSpace: 'screen'` (the default). A custom node that writes its own `draw` opts in the same way:

```ts
override draw(ctx, camera, _dt) {
  const s = camera.strokeSpaceScale()
  ctx.lineWidth = 1.5 * s
  ctx.setLineDash([6 * s, 4 * s])
  // ...
  ctx.stroke()
}
```

See [Scene graph](/guides/scene#stroke-widths-and-camera-zoom) for the per-primitive `strokeSpace` opt-in.

## Active vs game camera

`engine.camera` is always the game camera. `engine.activeCamera` is whatever is on screen right now, which is the game camera unless a dev debug camera has taken over. The renderer and the input system both use the active camera, so touching a shape still works while the debug camera is panning around it.

Read `engine.camera.viewport` for the game view; read `engine.activeCamera` for whatever is currently displayed.

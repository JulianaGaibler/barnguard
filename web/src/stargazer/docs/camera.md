# Camera

`Camera` describes a rectangular window into world coords. The renderer fits that window into the canvas at a uniform scale (aspect-preserving `contain`); no distortion, no letterbox bars, extra canvas area shows the clear color.

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

The Engine keeps `pixelSize` in sync with the canvas element on every `ResizeObserver` fire and on `window.resize`. Game code doesn't set it.

`Camera.getScreenTransform()` gives you the three numbers the renderer uses (`scale`, `offsetX`, `offsetY`). All in CSS px; DPR is applied separately as the ctx baseline.

For most game code you want either `worldToScreen` or `screenToWorld`. Both accept an optional `out: Vec2` to avoid allocating.

## The uniform fit

If the world viewport is `661 × 899` (Germany) and the canvas is `1920 × 1080`, the fit scale is `min(1920 / 661, 1080 / 899) = 1.201`. Germany renders at `794 × 1080` device px, centered horizontally with `(1920 − 794) / 2 = 563` px of clear color on each side.

Change the canvas size, or set `camera.viewport` to a smaller world rect, and the fit scale grows to match. Circles stay circular; rects stay rectangular; touch-slop stays the same physical size on screen.

## animateTo

Tween the viewport rect from its current value to a target rect:

```ts
import { easings } from '@src/stargazer'

await engine.camera.animateTo(
  { x: 0, y: 380, width: 661, height: 520 }, // lower half of Germany
  { duration: 0.5, easing: easings.inOutQuad },
)
```

`opts` accepts `duration` (default 0.5 s), `delay`, `easing`, and `signal`. The returned Promise resolves when the tween settles or rejects with `AbortError` on abort.

Under the hood it tweens a scratch `{ x, y, w, h }` object through the engine's `Animator` and calls `camera.setViewport(...)` on every tick, so `frameNum` increments and the renderer knows to bypass the static-layer cache during the tween.

Aborting one animateTo doesn't automatically cancel another one you might start immediately after; hold your own `AbortController`, abort it before starting a new tween, and pass the new controller's signal to `animateTo`:

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

`?demo=camera` uses this exact pattern.

## Stroke space scale

`camera.strokeSpaceScale()` returns the multiplier a node's `draw` should apply to a CSS-pixel `lineWidth` so the resulting stroke stays visually constant across camera zoom. The value is `1 / screenPxPerWorldUnit()` when the camera is initialised, and `1` when the pixel size is still `0` (fresh construction, before the first resize).

The engine primitives (`ShapeNode`, `Path2DNode`, `PolylineNode`) apply it automatically whenever `strokeSpace: 'screen'` (the default). Custom nodes that write their own `draw` opt in the same way:

```ts
override draw(ctx, camera, _dt) {
  const s = camera.strokeSpaceScale()
  ctx.lineWidth = 1.5 * s
  ctx.setLineDash([6 * s, 4 * s])
  // ...
  ctx.stroke()
}
```

See [`scene.md`](./scene.md#stroke-widths-and-camera-zoom) for the per-primitive `strokeSpace` opt-in.

## Active vs game camera

`engine.camera` is the game camera; always. `engine.activeCamera` is either the game camera or the debug camera, depending on whether the debug controller has swapped in (`?debug=hud` + `C`). The renderer uses the active camera; the input system also converts screen coords through the active camera so touching a shape still works when the debug camera is panning around it.

Read `engine.camera.viewport` when you want the game view. Read `engine.activeCamera` when you want whatever is on screen right now.

## Debug camera

When `DebugController` is constructed (via `?debug=1` or `?debug=hud`), it owns a `DebugCamera` extending `Camera`. Toggled with `C`:

- `WASD`. Pan, scaled to viewport size so it feels the same at any zoom.
- `Q` / `E`. Smooth exponential zoom.
- `R`. Snap to the game camera's current viewport.
- `G`. Follow mode. The debug camera mirrors the game camera each frame; useful for watching `animateTo` play out from a wider angle.

The debug camera's step runs in `engine.onBeforeFrame(...)`, ahead of `input.beforeFrame()`. Pointer world coords are always fresh; a shape being dragged keeps sticking to the cursor while the debug camera pans.

More in [`debug.md`](./debug.md).

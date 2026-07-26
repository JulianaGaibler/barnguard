# Camera

Cameras are scene-tree nodes. A `CameraNode2D` is a `Node2D`, so it has a `transform` and can be positioned, zoomed, rotated, and parented like any other node — and it also frames a world-space rect that the renderer fits into the canvas at a uniform scale (aspect-preserving `contain`, no distortion, no letterbox bars; extra canvas area shows the clear color).

Each `Stage` tracks one **current** 2D camera and renders through it. Cameras are never auto-created: add a `CameraNode2D` to the tree and call `makeCurrent()`. Until then `engine.currentCamera2D` is `null` and the stage renders only the clear color (the first camera attached becomes current automatically).

```ts
const cam = new CameraNode2D()
cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
engine.tree.root.add(cam)
cam.makeCurrent()
```

## Transform camera + rect framing

The two models compose. The framing rect sets the base fit; the node's world transform is an additional view offset on top (identity by default, so a plain framed camera behaves like a fixed window). The effective CSS-pixel world→screen affine is `containFit(framing) ∘ inverse(node.world)`.

```ts
class CameraNode2D extends Node2D {
  // rect framing (responsive fit)
  setViewport(rect: Rect): void
  animateTo(rect: Rect, opts?): Promise<void>
  clearFraming(): void // become a pure transform camera
  readonly viewport: Rect

  // transform camera
  zoom: number // sugar over transform.scale; larger = closer
  // position / rotation via this.transform

  // current-camera
  enabled: boolean
  makeCurrent(): void
  clearCurrent(enableNext?): void
  readonly isCurrent: boolean

  // view queries (the CameraView2D surface)
  worldToScreen(x, y, out?): Vec2
  screenToWorld(x, y, out?): Vec2
  visibleWorldRect(out?): Rect
  screenPxPerWorldUnit(): number
  strokeSpaceScale(): number
}
```

The stage keeps every registered camera's pixel size in sync with the canvas on every `ResizeObserver` fire and on `window.resize`. Game code doesn't set it.

Parent a camera under a moving node to make the view follow it; scale the camera node (or set `zoom`) to zoom; rotate it to rotate the view. For most game code you only need `setViewport` / `animateTo` and the `worldToScreen` / `screenToWorld` queries.

## The uniform fit

For a framing viewport of `W × H` world units in a canvas of `Cw × Ch` CSS px, the fit scale is `min(Cw / W, Ch / H)`. The viewport renders centered, and the leftover space on the wider axis shows the clear color. Change the canvas size, or `setViewport` to a smaller world rect, and the scale grows to match. Circles stay circular, and touch slop stays the same physical size on screen.

## Multiple cameras & the current camera

A stage can hold several camera nodes; only the current one renders. The first camera attached becomes current (the stage default is first). Switch with `makeCurrent()`, gate with `enabled` (disabling the current one promotes the next), and detaching the current camera promotes the next by `priority` then attachment order.

```ts
const cutscene = new CameraNode2D()
cutscene.setViewport({ x: 200, y: 100, width: 400, height: 300 })
scene.root.add(cutscene)
cutscene.makeCurrent() // stage now renders through this one
```

## animateTo

Tween the framing rect from its current value to a target:

```ts
import { easings } from '@src/stargazer'

await engine.currentCamera2D.animateTo(
  { x: 0, y: 380, width: 661, height: 520 },
  { duration: 0.5, easing: easings.inOutQuad },
)
```

`opts` accepts `duration` (default 0.5 s), `delay`, `easing`, and `signal`. The promise resolves when the tween settles, or rejects with `AbortError` on abort. Under the hood it tweens a scratch rect through the engine's `Animator`, so the renderer bypasses the static-layer cache during the tween.

Aborting one `animateTo` doesn't cancel another you start right after. Hold your own `AbortController`, abort it before starting a new tween, and pass the new signal:

```ts
let controller: AbortController | null = null

async function zoomTo(rect: Rect): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  await engine.currentCamera2D
    .animateTo(rect, { duration: 0.5, signal: controller.signal })
    .catch(ignoreAbort)
}
```

## Stroke space scale

`camera.strokeSpaceScale()` returns the multiplier a node's `draw` applies to a CSS-pixel `lineWidth` so the stroke stays visually constant across camera zoom. It's `1 / (the composed screen scale)` — so it accounts for both the framing fit and any camera `zoom` — and `1` while the pixel size is still `0` (fresh construction, before the first resize).

The engine primitives (`ShapeNode`, `Path2DNode`, `PolylineNode`) apply it automatically whenever `strokeSpace: 'screen'` (the default). A custom node that writes its own `draw` opts in the same way. The `camera` passed to `draw` is a `CameraView2D`:

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

## Active vs current camera

`engine.currentCamera2D` is the game camera the stage renders. `engine.activeCamera` is whatever is on screen right now — the current camera unless a dev debug camera has taken over. The renderer and the input system both use the active camera, so touching a shape still works while the debug camera is panning around it.

DOM anchors (`engine.dom`) and debug overlays project through the camera's full screen affine, so they track a translated / scaled / rotated / parented camera too.

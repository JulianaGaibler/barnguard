---
title: Camera
group: Features
order: 5
---

# Camera

A camera decides which part of the 2D world appears on the canvas. A {@link CameraNode2D} is a node in the scene tree. It frames a rect of world space, and the stage fits that rect into the canvas at a uniform scale.

Each {@link Stage} renders through one current 2D camera. The engine never creates a camera for you. Until you add one, `engine.currentCamera2D` is `null` and the stage draws only its clear color. The [Scene graph](/guides/scene) guide explains the tree the camera lives in.

## Basic usage

Add a camera to the tree and give it the world rect to show:

```ts
import { CameraNode2D } from '@src/stargazer'

const cam = new CameraNode2D()
cam.setViewport({ x: 0, y: 0, width: 1920, height: 1080 })
engine.tree.root.add(cam)
```

The stage shows the world from (0, 0) to (1920, 1080), scaled to fit the canvas. The first camera added to a stage becomes current on its own. A scene builder passed to `host.loadScene` adds its camera the same way, because loading a scene destroys the previous camera with the rest of the content.

### The uniform fit

For a viewport of `W × H` world units and a canvas of `Cw × Ch` CSS pixels, the scale is `min(Cw / W, Ch / H)`. The viewport is centered on the canvas. The extra space on the longer axis shows more of the world, or the clear color where nothing is drawn. Nothing is stretched, so circles stay round.

The stage resizes the fit when the canvas changes size, so you don't set the canvas size on the camera. `cam.visibleWorldRect()` returns the world rect the whole canvas shows, which is larger than the viewport when the canvas shape differs from the viewport's.

### Converting between screen and world

`worldToScreen(x, y)` maps a world point to CSS pixels relative to the canvas's top left corner. `screenToWorld(x, y)` maps the other way:

```ts
const p = cam.worldToScreen(ball.transform.x, ball.transform.y)
label.style.left = `${p.x}px` // an HTML label over the ball
```

Both take an optional `out` object to fill, so a call in a hot loop does not allocate. Pointer events already carry world positions, see [Input](/guides/input). For HTML that follows a node, use [HTML overlays](/guides/html-overlays) instead of converting by hand.

### Animating the view

[`animateTo`](/module/camera/cameranode2d#animateto) moves and resizes the viewport over time, a combined pan and zoom:

```ts
import { easings } from '@src/stargazer'

await cam.animateTo(
  { x: 0, y: 380, width: 661, height: 520 },
  { duration: 0.5, easing: easings.inOutQuad },
)
```

The options are `duration` in seconds (default 0.5), `delay`, `easing` and `signal`. The promise resolves when the viewport arrives, or rejects with an `AbortError` when the signal aborts. The animation runs on engine time, so it stops while the engine is paused.

### Switching cameras

A stage can hold several cameras, but only the current one renders. Call [`makeCurrent`](/module/camera/cameranode2d#makecurrent) to switch:

```ts
const closeUp = new CameraNode2D()
closeUp.setViewport({ x: 200, y: 100, width: 400, height: 300 })
scene.root.add(closeUp)
closeUp.makeCurrent() // the stage renders through this camera
```

`cam.isCurrent` tells whether a camera is the current one. `makeCurrent()` called before the camera is in a tree takes effect when it is added.

## Advanced usage

This section covers the transform camera, how the current camera is picked, canceling animations, stroke scale, layers, and the debug camera.

### Moving, zooming and rotating the camera node

A camera is a {@link Node2D}, so its `transform` works on the view. Moving the camera node pans the view, rotating it rotates the view, and [`zoom`](/module/camera/cameranode2d#zoom) zooms. A larger `zoom` is closer. `zoom` sets `transform.scaleX` and `transform.scaleY` to `1 / zoom`, because scaling the camera up shows more of the world.

The framing rect and the transform combine. The framing sets the base fit, and the node's world transform is an extra view offset on top. The transform is the identity by default, so a camera with only a viewport is a fixed window. The world-to-screen mapping in CSS pixels is `containFit(viewport) ∘ inverse(camera.world)`.

To make the view follow something, add the camera as a child of the node to follow. A camera cannot have children of its own: `cam.add(...)` throws.

[`clearFraming`](/module/camera/cameranode2d#clearframing) turns off the viewport fit. One world unit is then one CSS pixel, with the canvas centered on the camera's position, and the transform does all panning, zooming and rotating. `setViewport` or `animateTo` turns framing back on. `cam.framingEnabled` tells which mode is active.

### How the current camera is picked

The stage keeps a list of its cameras in the order they were added. These rules decide which one is current:

- The first camera added becomes current, unless another is current already.
- A camera added after `makeCurrent()` was called on it becomes current.
- `makeCurrent()` on a camera in the tree makes it current at once.
- Setting `enabled = false` on the current camera hands over to the next one.
- Removing or destroying the current camera hands over to the next one.
- `clearCurrent(false)` cancels a pending `makeCurrent()`.

The next camera is the enabled one with the highest `priority`, and the earliest added among equals. With no enabled camera left, `currentCamera2D` is `null`.

### Canceling a camera animation

Starting a second `animateTo` does not cancel the first, so two animations would fight over the viewport. Keep an `AbortController`, abort it before starting a new animation, and pass the new signal:

```ts
import { ignoreAbort, type Rect } from '@src/stargazer'

let controller: AbortController | null = null

async function zoomTo(rect: Rect): Promise<void> {
  controller?.abort()
  controller = new AbortController()
  await cam
    .animateTo(rect, { duration: 0.5, signal: controller.signal })
    .catch(ignoreAbort)
}
```

`animateTo` on a destroyed camera rejects with an `AbortError`.

### Stroke space scale

[`strokeSpaceScale`](/module/camera/cameranode2d#strokespacescale) returns the number of world units in one CSS pixel. Multiply a length in CSS pixels by it to get a world length that looks the same at any zoom. It accounts for the viewport fit and the camera's `zoom`. It returns 1 before the camera knows the canvas size. [`screenPxPerWorldUnit`](/module/camera/cameranode2d#screenpxperworldunit) is the inverse, CSS pixels per world unit.

The stroked nodes ({@link ShapeNode}, {@link Path2DNode}, {@link PolylineNode}) apply this scale for you while `strokeSpace` is `'screen'`, the default. A custom node writes a stroke width as `{ screen: n }` inside `paint` and never reads the camera, so a zoom does not repaint it:

```ts
override paint(canvas: Canvas): void {
  canvas.strokePolyline(this.points, this.count, {
    color: '#ffd34d',
    width: { screen: 1.5 },
  })
}
```

For other lengths, such as dash lengths, `canvas.screenScale()` returns the same value. Reading it makes the node repaint when the value changes, so prefer `{ screen: n }` where it applies. `canvas.visibleWorldRect()` is the other camera value `paint` can read. It makes the node repaint whenever the view changes, so use it only for content that fills the visible area. See [Scene graph](/guides/scene) for `strokeSpace` and [Drawing](/guides/drawing) for the rest of `Canvas`.

### Layers and the camera

The camera places everything in the tree, which a heads-up display does not want. A {@link Layer} with a `space` of `'screen'` or a frame places its subtree by a view of its own, and the camera does not move it. See [Layers](/guides/scene#layers).

{@link viewFor} returns the view that places a node: the layer's view under such a layer, and the stage's camera otherwise. Use it, not the camera, to find a node's position on screen. A frame layer fits its frame into the canvas the same way a camera fits its viewport.

### The debug camera and the active camera

`engine.currentCamera2D` is the primary stage's current camera, the one the game controls. `engine.activeCamera` is the view on screen right now. It is the current camera unless the debug camera is engaged. See [Debugging](/guides/debugging).

The renderer and the input system both use the active camera. A tap on a shape still works while the debug camera pans around it. The debug camera replaces only the stage's camera, never a layer's view. HTML overlays and the debug overlays project through the view that places each node, so they follow a moved, zoomed, rotated or parented camera.

### Canvas size

The stage tells every camera in its tree the canvas size in CSS pixels whenever the canvas resizes, through `ResizeObserver` and the window's `resize` event. A camera that becomes current later already has the right fit. The renderer applies the device pixel ratio separately, so every camera value is in CSS pixels.

## See also

- {@link CameraNode2D}: the 2D camera node
- {@link CameraView2D}: the view queries every 2D view answers
- {@link CameraAnimateOptions}: options for `animateTo`
- {@link CameraNode3D}: the 3D camera, see [3D](/guides/3d)
- {@link viewFor}: the view that places a node
- [Scene graph](/guides/scene): nodes, layers and stroke space
- [Input](/guides/input): pointer positions in world space
- [Stages](/guides/stages): one camera per stage

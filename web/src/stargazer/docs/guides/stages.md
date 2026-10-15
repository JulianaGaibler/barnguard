---
title: Stages
group: Features
order: 19
---

# Stages

A {@link Stage} is one canvas with its own scene tree, cameras and render target. The engine creates a primary stage for its own canvas. [`engine.attachStage`](/module/engine/engine#attachstage) adds secondary stages, which draw other scenes into other canvases on the same page.

Use a secondary stage when you want a second render surface on the same clock as the first. Examples are a small animated card next to the main view, a tutorial view, or a preview panel. All stages share one frame loop and one tween animator, so animations on two canvases stay in step. A second {@link EngineHost} would bring its own loop and input instead.

A stage is not the way to layer content inside one scene. Content that ignores the camera, such as a heads-up display, or content with its own post-processing, goes in a {@link Layer} in the same tree. A layer needs no second canvas or GPU context. See [Scene graph](/guides/scene) and [Post-processing](/guides/post-processing).

## Basic usage

This example attaches a stage to a second canvas and draws a circle on it. `engine` is `host.engine`.

```ts
import { CameraNode2D, ShapeNode } from '@src/stargazer'

const stage = engine.attachStage(cardCanvas, { name: 'card' })

const cam = new CameraNode2D()
cam.setViewport({ x: -120, y: -80, width: 240, height: 160 })
stage.tree.root.add(cam)

stage.tree.root.add(
  new ShapeNode({ geometry: { kind: 'circle', radius: 14 }, fill: '#c084fc' }),
)
```

The circle appears in the center of `cardCanvas`, over the page background. A secondary stage is transparent by default. Like the primary stage, it starts without a camera and draws nothing until a {@link CameraNode2D} is in its tree. `attachStage` throws when the canvas already has a stage, and this includes the primary canvas.

### Detach a stage

Detach a stage when its canvas goes away:

```ts
engine.detachStage(stage)
```

Detaching destroys the stage's tree. Every node's `abortSignal` fires, so node tweens reject with `AbortError`. It also removes the stage's input handling and resize observer, frees its GPU resources, and releases the canvas, so you can attach it again later. `engine.destroy()` detaches every secondary stage before it destroys the primary.

### Mount a stage in Svelte

The {@link mountStage} action attaches a stage when the canvas mounts and detaches it when the canvas unmounts.

```svelte
<script lang="ts">
  import { mountStage, CameraNode2D } from '@src/stargazer'
  import type { Engine, Stage } from '@src/stargazer'

  const { engine }: { engine: Engine } = $props()

  function buildScene(stage: Stage): void {
    const cam = new CameraNode2D()
    cam.setViewport({ x: -100, y: -100, width: 200, height: 200 })
    stage.tree.root.add(cam)
    // Add the rest of the scene under stage.tree.root.
  }
</script>

<canvas
  use:mountStage={{
    engine,
    options: { name: 'preview' },
    onReady: buildScene,
  }}
></canvas>
```

`options` is passed to `attachStage`. `onDestroy`, if you pass it, runs before the stage is detached.

### Take pointer input

A secondary stage gets no pointer input by default. Pass `interactive: true` and the nodes on the stage receive pointer events, the same way nodes on the primary stage do.

```ts
import { ShapeNode } from '@src/stargazer'

const stage = engine.attachStage(cardCanvas, { interactive: true })

const marker = new ShapeNode({
  geometry: { kind: 'circle', radius: 14 },
  fill: '#c084fc',
})
marker.bindPointer({
  singlePointer: true,
  move: (e) => {
    marker.transform.x = e.pointer.world.x
    marker.transform.y = e.pointer.world.y
  },
})
stage.tree.root.add(marker)
```

The marker follows a finger or the mouse while it is pressed on the marker. The stage hit-tests its own tree and maps pointers through its own current camera.

The stage emits `pointerDown`, `pointerMove`, `pointerUp` and `pointerCancel` on `stage.events`. These events don't reach `engine.events`, so a tap on a secondary canvas can't trigger handlers for the main view. The primary stage's pointer events do reach `engine.events`. See [Input](/guides/input).

Each canvas captures its own pointers. A pointer that goes down on one canvas stays with that canvas when it moves onto another. A finger on the primary canvas and a finger on a secondary canvas work at the same time.

### Park a stage

[`stage.setActive(false)`](/module/render/stage#setactive) takes a stage out of the frame. The engine doesn't update its nodes, compute its transforms, or render it. `setActive(true)` brings it back at once, with no setup and no new GPU context. You can keep a stage prepared and parked until it is needed.

## Advanced usage

This section covers the stage options, what stages share, resizing, capturing a scene as an image, context loss, and how stages interact with physics and the backends.

### Stage options

[`attachStage`](/module/engine/engine#attachstage) takes {@link StageOptions}. Every field is optional.

| Option           | Default        | Meaning                                                                                              |
| ---------------- | -------------- | ---------------------------------------------------------------------------------------------------- |
| `clearColor`     | `'#0d1a2c'`    | Color the frame is cleared to when `transparent` is `false`.                                         |
| `transparent`    | `true`         | Clear to zero alpha, so the page behind the canvas shows. Set it to `false` for an opaque stage.     |
| `interactive`    | `false`        | Give the stage its own pointer input.                                                                |
| `name`           | `Stage N`      | Label in the debug HUD's stage list.                                                                 |
| `msaaSamples`    | engine's count | Multisample count. `1` turns it off.                                                                 |
| `renderScale`    | `1`            | Factor on the device pixel ratio, from `0.1` to `2`.                                                 |
| `onResize`       |                | Called after the stage resizes its backing store and its cameras.                                    |
| `gpuDevice`      | WebGL2         | The device the stage draws with.                                                                     |
| `directPresent`  | `true`         | Draw the frame in the canvas's own format. `false` draws into a target that is copied to the canvas. |
| `physics`        |                | Give the stage a {@link PhysicsWorld}. `true` uses the defaults, or pass a config.                   |
| `fixedPixelSize` |                | Render at exactly this width and height in pixels, whatever the CSS size and pixel ratio.            |
| `exactText`      | `false`        | Rasterize text at its exact size on every frame, for a stage whose frames are separate stills.       |

`renderScale` shrinks the backing store while the CSS size stays the same, and the browser scales the result up. Everything on the stage, including the 3D pass and post-processing, renders at the lower resolution. It's one setting for a stage whose cost grows with its pixel count. [`stage.renderScale`](/module/render/stage#renderscale) can also be set while the stage runs. The engine lowers it on the primary stage when the GPU can't keep up. See [Engine setup](/guides/setup).

### What stages share

These parts are shared by all stages:

- the {@link Ticker}, so one animation frame drives every stage
- the tween animator, so `engine.animation.cancelAll()` stops tweens on every stage
- the pause flag, so `engine.setPaused(true)` freezes every stage

A tween on a secondary stage advances in the same frame and by the same `dt` as one on the primary stage:

```ts
engine.tween(mainNode.transform, { x: 700 }, { duration: 2 })
engine.tween(cardNode.transform, { x: 100 }, { duration: 2 })
// Both tweens end on the same frame.
```

`onUpdate` and `onFixedStep` run on every active stage. Keep fixed-step work small when you attach several stages, because it can run up to 8 times per frame.

Each stage has its own scene tree, cameras, render target, GPU context, texture caches and input. Text that appears on two stages is rasterized once per stage.

Asset data has no GPU handles, so one instance can back nodes on several stages. This includes a `Path2D`, a {@link BitmapMask} and an image. Path tessellations from {@link parseSvgPaths} are shared by every stage too.

```ts
import { Path2DNode, parseSvgPaths } from '@src/stargazer'

const { paths } = parseSvgPaths(svgSource, { tessellate: true })
const badge = paths.get('badge')!.path

engine.tree.root.add(new Path2DNode({ path: badge, fill: '#88c' }))
stage.tree.root.add(new Path2DNode({ path: badge, fill: '#fff' }))
```

### Resize and pixel ratio

Every stage watches its canvas with a `ResizeObserver` and listens for `window` resize. When the CSS size or the device pixel ratio changes, the stage sizes the backing store to the CSS size times the pixel ratio times `renderScale`. It then resizes its render target, refits every 2D camera, and calls `onResize`. The engine's `resize` event fires only for the primary canvas.

A stage with `fixedPixelSize` skips all of this. It renders at exactly that many pixels, with a pixel ratio of 1, and doesn't watch its canvas, so the canvas doesn't need to be in the document. [`stage.setFixedPixelSize`](/module/render/stage#setfixedpixelsize) changes the size later.

### Capture a scene as an image

[`engine.capture`](/module/engine/engine#capture) renders a scene to an `ImageBitmap`, and [`engine.captureBlob`](/module/engine/engine#captureblob) encodes it as an image file such as a PNG or a JPEG. Use them for a thumbnail, a share image, or any still that should look like the rest of the app.

In the following example, a 400 by 200 pixel card with a gradient and a title is encoded as a JPEG.

```ts
import { ShapeNode, TextNode, cssLinearGradient } from '@src/stargazer'

const jpeg = await engine.captureBlob({
  width: 400,
  height: 200,
  type: 'image/jpeg',
  quality: 0.9,
  build: (root) => {
    root.add(
      new ShapeNode({
        geometry: { kind: 'rect', width: 400, height: 200, centered: false },
        fill: cssLinearGradient(400, 200, 135, [
          { offset: 0, color: '#ff6600' },
          { offset: 1, color: '#fb2872' },
        ]),
      }),
    )
    root.add(
      new TextNode({
        text: 'Level 3',
        x: 24,
        y: 120,
        fontSize: 48,
        color: '#fff',
      }),
    )
  },
})
```

`build` adds the scene to `root`, where one unit is one pixel and the origin is the top left corner. The image is exactly 400 by 200 pixels, whatever the display's pixel ratio. Without a `clearColor`, the background is transparent, which a JPEG shows as black. `build` can be async, so it can load fonts and images before it adds nodes.

A capture renders outside the frame loop, so it also works while the engine is stopped or paused. Captures run one at a time, in the order they were called.

All captures go through one inactive secondary stage, created on the first capture. It has a fixed pixel size and `exactText`. Each capture destroys the scene it built once the image is taken. The stage, and the GPU context it holds, is detached after {@link CAPTURE_IDLE_RELEASE_SEC} seconds without a capture, or when the engine is destroyed.

A capture renders two frames by default before it takes the image. The first frame of a new scene uploads its text, gradients, and path shadow masks, drawing stand-ins until they are ready. The second frame is the first that shows them all. `settleFrames` changes the count. A layer whose effects are still compiling draws without them, so the capture waits for the compile and renders its frames again.

Choose `capture` for an image to draw again, for example on another canvas, and `captureBlob` for a file to save, send, or show in an `<img>` element.

### Physics on a stage

The engine steps every registered physics world, whether or not its stage is active. A world that a {@link PhysicsWorldBehavior} registered on a parked stage keeps simulating. To stop it, destroy that node, for example with [`stage.clearScene()`](/module/render/stage#clearscene), before you park the stage.

### Backend and context loss

A secondary stage creates its own WebGL2 context, also when the primary stage uses WebGPU. To use WebGPU on a secondary stage, pass a device from {@link selectGfxDevice} as `gpuDevice`.

The host's recovery for a lost context covers only the primary canvas. See [Engine setup](/guides/setup). For a secondary stage, listen for `webglcontextrestored` on its canvas and call [`stage.reacquireContext()`](/module/render/stage#reacquirecontext), or detach the stage and attach it again.

## See also

- {@link Stage}: one canvas with its own tree
- {@link StageOptions}: options for `attachStage`
- {@link CaptureOptions}, {@link CaptureBlobOptions}: options for `capture` and `captureBlob`
- {@link Engine}: owns the primary stage and attaches the others
- {@link mountStage}: Svelte action that attaches a stage
- [Engine setup](/guides/setup): mounting the engine and context loss
- [Architecture](/guides/architecture): what a frame does on each stage
- [Input](/guides/input): pointer events and capture
- [Scene graph](/guides/scene): layers inside one scene

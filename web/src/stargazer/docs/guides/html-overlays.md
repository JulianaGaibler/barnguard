---
title: HTML overlays
group: Features
order: 17
---

# HTML overlays

Some UI is easier to build in HTML than to draw on the canvas, such as menus, pause screens and forms. An HTML overlay attaches an HTML element to a scene node. Each frame, the engine sets the element's CSS `transform` so that it sits over the node on the canvas. The node's position, scale, rotation and pivot apply, and the camera's pan and zoom apply on top.

The engine only sets the element's position and size. It never changes what is inside the element. Attach elements through `engine.dom`, a {@link DomTransformSync}, or with the {@link domAnchor} Svelte action.

## Basic usage

In Svelte, add the `domAnchor` action to the element:

```svelte
<script lang="ts">
  import { domAnchor } from '@src/stargazer'
</script>

<div
  use:domAnchor={{
    engine: host.engine,
    node,
    size: { width: 480, height: 320 },
  }}
>
  <Menu />
</div>
```

The element is 480 by 320 world units and sits over the node's local area from `(0, 0)` to `(480, 320)`. When the camera pans or zooms, the element moves and scales with the scene. The action attaches on mount and detaches on unmount.

Without Svelte, call [`engine.dom.attach`](/module/dom/domtransformsync#attach) and keep the handle it returns:

```ts
const handle = engine.dom.attach(node, element, {
  size: { width: 480, height: 320 },
})
// later
handle.detach()
```

In both cases, the element detaches by itself when its node is destroyed.

### Put the element over the canvas

The engine does not move the element in the page. It only sets its `transform`, measured from the canvas's top-left corner. **Put the element in a container that covers exactly the same rect as the canvas.** Padding, a border or an offset on that container shifts every element away from the scene.

The usual setup is a wrapper that holds the canvas and an overlay container on top of it:

```svelte
<div class="stage">
  <canvas use:mountEngine={{ onReady }}></canvas>
  <div class="overlay">
    <div use:domAnchor={{ engine, node, size }}>
      <Menu />
    </div>
  </div>
</div>

<style>
  .stage {
    position: relative;
  }
  .overlay {
    position: absolute;
    inset: 0; /* same rect as the canvas, no padding or border */
    pointer-events: none; /* clicks fall through to the canvas */
  }
  .overlay button {
    pointer-events: auto; /* buttons still get clicks */
  }
</style>
```

The overlay container ignores pointer events, so the canvas still gets them. Set `pointer-events: auto` on the elements that need clicks.

When you attach an element, the engine sets its `position` to `absolute`, its `left`, `top` and `margin` to `0`, and its `transform-origin` to the top-left corner. The element stays hidden until the first frame places it.

### Cover the node's rect

With `size`, the element's CSS `width` and `height` are set to that size in world units. One CSS pixel of the element is one world unit before the transform. The element's top-left corner is the node's local origin, the same point the node draws from, with its pivot applied. The engine then applies the node's world transform and the camera, so the element covers the area where the canvas draws the node.

Lay out the element's content against that box. In this example, the menu stays centered on the node wherever the camera goes:

```svelte
<div use:domAnchor={{ engine, node, size: { width: 1920, height: 1080 } }}>
  <!-- 1920 by 1080 before the transform, the engine scales it to the screen -->
  <div class="menu">
    <h1>Paused</h1>
    <button onclick={resume}>Resume</button>
  </div>
</div>

<style>
  .menu {
    position: absolute;
    inset: 0;
    display: grid;
    place-content: center;
  }
</style>
```

The camera's scale is a CSS transform, so text stays sharp at every zoom level.

### Anchor a point

Without `size`, the engine anchors only the element's top-left corner to the node's origin. The element keeps its own CSS width and height. The node's transform and the camera still apply, so the element still scales and rotates with the scene. Use this for a label or a badge on a point in the world.

```ts
engine.dom.attach(markerNode, badgeElement)
```

## Advanced usage

This section covers the attach options, view transitions, layers, 3D nodes, stacking and cost.

### Attach options

[`attach`](/module/dom/domtransformsync#attach) and `domAnchor` take these options from {@link DomAttachOptions}:

| Option           | Default | Meaning                                                                                   |
| ---------------- | ------- | ----------------------------------------------------------------------------------------- |
| `size`           | none    | `{ width, height }` in world units. Sets the element's size so it covers the node's rect. |
| `syncVisibility` | `true`  | Hides the element with `display: none` when the node or an ancestor is not visible.       |
| `syncOpacity`    | `false` | Sets the element's `opacity` to the node's `alpha` multiplied by its ancestors' `alpha`.  |
| `cull`           | `false` | Hides the element with `display: none` when its rect is fully outside the canvas.         |

`syncOpacity` is off by default so it doesn't overwrite a CSS fade of your own. Without `size`, `cull` tests only the node's origin point.

The engine also hides the element when no camera places the node, or while the camera's mapping is degenerate, such as during a resize to zero size.

### Change options or detach

The {@link DomAttachment} handle has [`setOptions`](/module/dom/domattachment#setoptions), which replaces all options at once, for example with a new `size`. [`detach`](/module/dom/domattachment#detach) stops the sync. It leaves the element's styles as they were last written.

The `domAnchor` action calls `setOptions` when its parameters change. It detaches and attaches again only when `engine` or `node` changes, so an inline parameter object doesn't cause extra work.

### Switch views with the camera

With `cull`, a camera move can be the whole transition between two views. Place each view's UI on a node in its own region of the world and pass `cull: true`. To switch, animate the camera. The old view's UI slides off and hides once it leaves the canvas. The new view's UI slides in and shows itself.

```svelte
<script lang="ts">
  import { Node2D, domAnchor } from '@src/stargazer'

  const { engine } = $props()

  // Two regions side by side: the menu at x = 0, the board at x = 2000.
  const menuAnchor = new Node2D('menu-region')
  const boardAnchor = new Node2D('board-region')
  boardAnchor.transform.x = 2000
  engine.tree.root.add(menuAnchor)
  engine.tree.root.add(boardAnchor)

  const size = { width: 1920, height: 1080 }

  function showBoard() {
    engine.currentCamera2D?.animateTo(
      { x: 2000, y: 0, width: 1920, height: 1080 },
      { duration: 0.6 },
    )
  }
</script>

<div use:domAnchor={{ engine, node: menuAnchor, size, cull: true }}>
  <MainMenu onPlay={showBoard} />
</div>
<div use:domAnchor={{ engine, node: boardAnchor, size, cull: true }}>
  <BoardControls />
</div>
```

Nothing coordinates the two overlays. During the pan, the menu moves off the left edge and gets `display: none`, which also removes it from page layout and from hit testing. The board controls move in and show. Panning back reverses it.

### Anchor to a layer

An overlay follows the view that places its node. A node under a {@link Layer} with a `space` of `'screen'` or a frame is placed by the layer, not the camera. Its element stays still while the camera pans and zooms. Use this for HTML in a heads-up display: lay out the display for a fixed design rect and anchor each element to a node in it.

```ts
import { Layer, Node2D } from '@src/stargazer'

const ui = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
})
engine.tree.root.add(ui)

const panel = new Node2D('panel')
panel.transform.x = 1500
ui.add(panel)
// use:domAnchor={{ engine, node: panel, size: { width: 360, height: 200 } }}
```

The element scales with the frame, so the markup keeps its layout at any canvas shape. While the debug camera is on, it replaces the stage camera for overlays too, but not a layer's own view.

### Anchor to a 3D node

[`engine.dom.attachWorld3d(node, element, camera, opts)`](/module/dom/domtransformsync#attachworld3d) and the {@link domAnchor3d} action pin an element to a {@link Node3D}. By default the element stays upright on screen, is centered on the node's projected origin, and hides when the node is behind the camera. The options in {@link Dom3DAttachOptions} add scaling with distance, or a mode that tilts the element with the node's surface. See [3D](/guides/3d).

### Stacking order and sharp text

The page decides which overlay is on top, not the scene tree. Two overlays overlap by their DOM order or their CSS `z-index`. The depth of their nodes in the scene graph has no effect.

Don't set `will-change: transform` on an element that the camera zooms. The browser then keeps a fixed-size image of the element and scales that, so text blurs when scaled up.

### Cost and timing

The sync runs once per frame, on the engine's `frame` event, after every stage has rendered. The element and the canvas therefore change on the same frame.

Each frame, the engine compares the new matrix with the last one it wrote, with a small tolerance. It writes `transform` only when the matrix changed, so a still overlay costs no style writes. Browsers apply a `transform` or `opacity` change without page layout. The engine writes `width` and `height` only when `size` changes.

`engine.dom` is created the first time you use it. An engine that never uses overlays doesn't run the sync.

### Project a matrix yourself

{@link projectWorldToCss} is the function behind the sync. It combines a camera's screen affine with a node's world matrix into the six values of a CSS `matrix()`. Use it when you place an element yourself.

```ts
import { projectWorldToCss } from '@src/stargazer'

const m = projectWorldToCss(camera.getScreenAffine(), node.transform.world)
element.style.transform = `matrix(${m.a},${m.b},${m.c},${m.d},${m.e},${m.f})`
```

## See also

- {@link DomTransformSync}: the per-engine overlay manager, reached as `engine.dom`
- {@link DomAttachOptions}: options for a 2D overlay
- {@link domAnchor}: the Svelte action for a 2D node
- {@link domAnchor3d}: the Svelte action for a 3D node
- {@link projectWorldToCss}: the projection the sync uses
- [Camera](/guides/camera): pan, zoom and `animateTo`
- [Scene graph](/guides/scene): layers and visibility
- [3D](/guides/3d): overlays on 3D nodes
- [Accessibility](/guides/accessibility): screen reader access for canvas content

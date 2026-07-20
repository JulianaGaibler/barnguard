# HTML overlays

Some UI is easier to build as HTML than to draw on the canvas: menus, pause
screens, a game's selection screen. This attaches such an element to a scene
node so the engine drives its CSS transform each frame, keeping it flush with the
canvas. The node's position, scale, rotation, and pivot carry through, and the
camera pan/zoom applies on top, so the element tracks the scene the way a native
node does. The engine never touches what's inside the element, only its box.

## Attaching an element

From Svelte, use the `domAnchor` action on the element:

```svelte
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

Without Svelte, attach through `engine.dom` and keep the handle to detach:

```ts
const handle = engine.dom.attach(node, element, {
  size: { width: 480, height: 320 },
})
// ...later
handle.detach()
```

Either way the element detaches automatically if its node is destroyed.

## The coordinate contract

Before the transform, the element's box is in world units: one CSS pixel is one
world unit, and the element's top-left corner is the node's local origin (the
same origin the node draws from, with its pivot already accounted for). The
engine then applies the node's world transform and the camera, so the element
ends up over the exact region the canvas would draw the node.

Pass `size` (world units) to run in rect mode: the element's width and height are
pinned to that size, so it exactly overlays the node's rect, and the camera scale
sizes it on screen. Because the scaling is a CSS transform, text stays crisp as
the camera zooms. Omit `size` to only anchor the origin and let the element size
itself.

In rect mode you lay the element out against the node's box, so a child centered
with `inset: 0` sits centered on the node wherever the camera puts it:

```svelte
<div use:domAnchor={{ engine, node, size: { width: 1920, height: 1080 } }}>
  <!-- 1920×1080 before the transform; the engine scales it to the screen -->
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

Without `size`, only the origin is anchored and the element keeps its own CSS
width and height. The node's transform and the camera still apply, so the
element scales and rotates with the scene; it just isn't pinned to a specific
world rect. This suits a label or badge tacked to a point in the world:

```ts
engine.dom.attach(markerNode, badgeEl) // badgeEl sizes itself; origin tracks the node
```

Three more options: `syncVisibility` (default on) hides the element with
`display:none` when the node or any ancestor is not visible; `syncOpacity`
(default off) mirrors the node's compounded alpha onto the element; and `cull`
(default off) hides the element once its rect leaves the canvas, so a panel can
ride the camera off-screen and drop out of layout and hit-testing on its own.

## Riding the camera between views

`cull` turns a camera move into the whole transition. Put each view's UI on a
node in that view's region and pass `cull: true`. To switch views, just animate
the camera: the outgoing view's UI slides off and hides itself once it clears the
canvas, and the incoming view's UI slides in and reveals itself. There's no
fade-then-move handshake, because nothing is ever stranded on screen over a
moving camera.

Lay the views out side by side in the world, anchor each one's UI to a node at
its region, and switch by panning the camera:

```svelte
<script lang="ts">
  import { SceneNode, domAnchor } from '@src/stargazer'

  const { engine } = $props()

  // Two regions side by side: menu at x=0, game at x=2000.
  const menuAnchor = new SceneNode('menu-region')
  const gameAnchor = new SceneNode('game-region')
  gameAnchor.transform.x = 2000
  engine.scene.root.add(menuAnchor)
  engine.scene.root.add(gameAnchor)

  const size = { width: 1920, height: 1080 }

  function enterGame() {
    engine.camera.animateTo(
      { x: 2000, y: 0, width: 1920, height: 1080 },
      { duration: 0.6 },
    )
  }
</script>

<div use:domAnchor={{ engine, node: menuAnchor, size, cull: true }}>
  <MainMenu onPlay={enterGame} />
</div>
<div use:domAnchor={{ engine, node: gameAnchor, size, cull: true }}>
  <GameHud />
</div>
```

Nothing coordinates the two overlays. During the pan the menu drifts off the
left edge and drops out once it's gone (`cull` sets `display:none`), while the
game HUD slides in and comes back into layout and hit-testing on its own. The
reverse pan swaps them back.

## Where the element must live

The engine writes only the element's transform; it does not move the element in
the DOM. Put it in a container that overlays the canvas exactly, with the same
bounding rect. Any padding, border, or offset on that container shifts the
element off the canvas, because the camera's offset is measured from the canvas
top-left.

The usual shape is a wrapper holding the canvas and an overlay layer stacked on
top of it:

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
    inset: 0; /* exact same rect as the canvas, no padding or border */
    pointer-events: none; /* clicks fall through to the canvas */
  }
</style>
```

## Things to watch

- Layering follows the DOM, not the scene tree. Two anchored elements overlap by
  their DOM order or CSS `z-index`; the depth of their nodes in the scene graph
  has no effect.
- The overlay container is click-through so the canvas still receives pointer
  events. An interactive element sets `pointer-events: auto` on itself (or its
  buttons) to capture clicks:

  ```css
  .overlay {
    pointer-events: none;
  } /* container: click-through */
  .overlay button {
    pointer-events: auto;
  } /* buttons: clickable */
  ```

- Avoid `will-change: transform` on an element that the camera zooms. It snapshots
  the element to a raster layer, so text blurs when scaled up. Leave it off unless
  a pure-pan overlay measurably needs it.

## Cost

The sync writes `transform` (and `opacity`, when enabled), which the browser
composites without layout or paint. Width and height are written only when `size`
changes, never per frame. Each attachment's matrix is compared against the last
write with a small epsilon, so a static overlay writes nothing and sub-pixel
jitter from camera smoothing doesn't churn styles. The work runs once per frame,
right after the scene renders, so the element and the canvas update together.

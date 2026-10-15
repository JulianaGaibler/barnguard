---
title: Drawing
group: Getting started
order: 4
---

# Drawing

A 2D node draws by recording what it looks like into a {@link Picture}. The engine replays the picture every frame under the node's transform and alpha. Moving, scaling, fading or rotating a node never runs its drawing code again.

The built-in nodes record for you. {@link ShapeNode} draws circles, ellipses and rectangles, {@link Path2DNode} draws SVG paths, {@link PolylineNode} draws lines, {@link ImageNode} draws images, and {@link TextNode} draws text. They handle bounds, hit testing and stroke scaling. When none of them fits, such as for a board's grid or a gauge, subclass {@link Node2D} and override [`paint`](/module/scene/node2d#paint). You then record through a {@link Canvas}, in the node's own local coordinates.

You need a stage with a scene first. See [Setup](/guides/setup) and [Scene graph](/guides/scene).

## Basic usage

The smallest drawing is a built-in node added to the scene.

```ts
import { ShapeNode } from '@src/stargazer'

const card = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
  fill: '#1c2438',
  stroke: '#ffd34d',
  lineWidth: 2,
})
card.transform.x = 200
card.transform.y = 120
scene.root.add(card)
```

This draws a rounded rectangle centered on `(200, 120)`, filled dark blue with a 2 pixel yellow border. The border stays 2 CSS pixels wide at any camera zoom, because `strokeSpace` is `'screen'` by default. Writing `card.fill = '#2a3550'` repaints the card. Writing `card.transform.x` moves it without repainting.

### Draw your own content

Override `paint` on a `Node2D` subclass and call drawing methods on the `Canvas` it receives. Declare the values `paint` reads with {@link definePaintProps}, so that writing one repaints the node.

```ts
import { Node2D, definePaintProps } from '@src/stargazer'
import type { Canvas } from '@src/stargazer'

class Gauge extends Node2D {
  declare value: number

  constructor() {
    super()
    definePaintProps(this, { value: 0.4 })
  }

  override paint(canvas: Canvas): void {
    canvas.fillRoundRect(0, 0, 200, 24, 12, '#1c2438')
    canvas.fillRoundRect(0, 0, 200 * this.value, 24, 12, '#ffd34d')
  }
}
```

The gauge draws a dark track and a yellow bar over 40 percent of it. Declare each property with `declare` and no initializer. A class field with an initializer hides the accessor, and in development `definePaintProps` throws when it finds one.

### When a node paints again

`paint` runs the first time the node is drawn. After that it runs only when the node is dirty. A node becomes dirty in these cases:

- A paint property changes, including a change made by a tween.
- A resource it declared with [`canvas.use`](/module/scene/canvas#use) changes its `version`.
- Code calls [`markNeedsPaint()`](/module/scene/node2d#markneedspaint) on it.
- The picture depends on scale, and the scale the node is drawn at stops at a new value.

Writing `gauge.value = 0.8`, or tweening it, repaints the gauge. Writing `gauge.transform.x`, `alpha` or `visible` does not.

### Fills and colors

Each fill call takes its color as an argument. A fill is a CSS color string or a gradient.

```ts
override paint(canvas: Canvas): void {
  canvas.fillRect(0, 0, 320, 200, '#101522')
  canvas.fillCircle(160, 100, 40, '#7cc4ff')
  canvas.fillRoundRect(20, 20, 80, 32, [8, 8, 0, 0], {
    kind: 'linear',
    x0: 0,
    y0: 20,
    x1: 0,
    y1: 52,
    stops: [
      { offset: 0, color: '#3a2d5c' },
      { offset: 1, color: '#1d1d2b' },
    ],
  })
}
```

`fillRoundRect` takes the CSS `border-radius` shorthand: `24`, `[0, 32, 0, 0]` or `[tl, tr, br, bl]`. A radius at or above half the shorter side gives a capsule. Circles and rounded rectangles are drawn as signed distance fields in local space, so they stay crisp at any zoom or rotation.

### Strokes

A stroke takes a full style object on every call. There is no current style to set first. Keep a style that never changes in a module-level constant.

```ts
const RULE = { color: '#2a3550', width: { screen: 1 } }

override paint(canvas: Canvas): void {
  for (let i = 0; i <= 8; i++) {
    canvas.strokeLine(0, i * 40, 320, i * 40, RULE)
  }
}
```

A stroke width is a number in the node's local units, or `{ screen: n }` for `n` CSS pixels at any zoom. The renderer resolves a screen width each frame, so the picture does not repaint when the camera zooms. Dash lengths are in local units. The style type is {@link CanvasStrokeStyle}.

### Clip to a shape

[`setClip`](/module/scene/canvas#setclip) crops every following draw to a circle or a rounded rectangle, with an anti-aliased edge. Bracket it with `save` and `restore`.

```ts
canvas.save()
canvas.setClip({ kind: 'roundRect', x: 0, y: 0, w: 240, h: 160, radius: 16 })
canvas.drawImage(portrait, 0, 0, 240, 160)
canvas.restore()
```

The image shows only inside the rounded rectangle. A rounded rectangle clip takes `radii` in place of `radius` for different corners, in the same shorthand as `fillRoundRect`. `setClip(null)` clears the clip, and `restore` does too. To clip a whole subtree of nodes instead, set [`clip`](/module/scene/node2d#clip) on the parent node. A node clip never repaints anything.

### Smooth corners

A rounded rectangle can have smooth corners instead of circular ones, as with the corner smoothing setting in Figma. A smooth corner eases from the straight side into its curve, so the shape reads as one continuous outline. `smoothing` runs from 0, a circular corner, to 1. {@link IOS_CORNER_SMOOTHING}, 0.6, matches the iOS app icon shape.

```ts
import { IOS_CORNER_SMOOTHING, ShapeNode } from '@src/stargazer'

const icon = new ShapeNode({
  geometry: {
    kind: 'rect',
    width: 120,
    height: 120,
    radii: 27,
    smoothing: IOS_CORNER_SMOOTHING,
  },
  fill: '#ffffff',
})
```

The icon draws in the same single instance as any rounded rectangle. A smooth corner uses more of each side than a circular one, `(1 + smoothing)` times its radius. When a side is too short for that, smoothing is reduced before the radius is, the way Figma fits corners. Inside `paint`, `fillRoundRect`, `strokeRoundRect`, `fillAndStrokeRoundRect` and `shadowRoundRect` take `smoothing` as their last parameter.

To mask other content, such as a photo, to a smooth-cornered shape, use a squircle {@link ShapeNode} as the content's [`matte`](/module/scene/node2d#matte), which gives an anti-aliased edge. For a cheaper hard-edged clip, set the parent's [`clip`](/module/scene/node2d#clip) to an outline from {@link squirclePath}.

```ts
import { GfxPath, IOS_CORNER_SMOOTHING, squirclePath } from '@src/stargazer'

card.clip = squirclePath(
  new GfxPath(),
  0,
  0,
  200,
  120,
  24,
  IOS_CORNER_SMOOTHING,
)
```

Everything under `card` is clipped to the 200 by 120 shape. {@link squircleSvgPath} gives the same outline as SVG path data, and {@link squirclePath2D} gives it as a `Path2D` that a {@link Path2DNode} can draw.

### Draw an image

An {@link ImageNode} draws a loaded image, such as an `<img>` element, an `ImageBitmap`, or a canvas, as a rectangle.

```ts
import { ImageNode } from '@src/stargazer'

const logo = new Image()
logo.src = '/logo.png'
await logo.decode()

scene.root.add(new ImageNode({ image: logo, x: 16, y: 16, height: 40 }))
```

The logo is drawn 40 units high at `(16, 16)`, with the width that keeps its proportions. Give both `width` and `height` to stretch it, or neither to draw it at its natural size. Assigning a new `image` shows on the next frame.

The GPU samples an image without mipmaps, so an image drawn at a small fraction of its natural size looks jagged. Scale it to the drawn size once, for example with `createImageBitmap(image, { resizeWidth, resizeHeight, resizeQuality: 'high' })`.

## Advanced usage

This section covers the rules `paint` must follow, the full set of drawing calls, paths, borders, shadows, compositing groups, layers, custom shaders, and what costs time on the GPU.

### Rules for `paint`

`paint` has to be a function of the node's declared state. It must not read the clock, the node's own transform, the camera, or state that is not declared. It must not dirty any node, and in development `markNeedsPaint` throws while a node paints.

A node whose content changes every frame, such as a growing bar or a trail, calls `markNeedsPaint()` from `onUpdate`. In development the engine paints two clean nodes again each frame and warns when the result differs from the picture it kept. That is how an undeclared dependency shows up.

Content that moves or turns on a clock belongs in a small child node, whose transform the update writes. Painting a rotation into the parent would repaint the parent for the whole turn.

The canvas copies arguments when it records them. A scratch array or a style object that the caller reuses can change afterwards without changing the picture. Images and paths are kept by reference. A `Canvas` is valid only while `paint` runs, and in development a call after that throws.

### Reading the scale and the view

[`canvas.screenScale()`](/module/scene/canvas#screenscale) returns the world size of one CSS pixel. Use it for a screen-sized length that is not a stroke width, such as a shadow offset. Reading it makes the picture repaint whenever that size changes, so prefer `{ screen: n }` where it fits.

[`canvas.visibleWorldRect()`](/module/scene/canvas#visibleworldrect) returns the world rectangle the camera shows. Reading it makes the picture repaint every time the camera moves. Use it only for a node that draws to the edges of the screen.

### All drawing calls

The `Canvas` has these fill calls:

- `fillRect`, `fillRoundRect`, `fillCircle`, `fillEllipse`, `fillConvexPoly`
- `fillPath` for a {@link GfxPath}, and `fillPath2D` for a registered `Path2D`
- `fillCircleRadialGradient`, `fillPolyLinearGradient`, `fillMaskedRadialGradient`

It has these stroke calls:

- `strokeLine`, `strokeQuadratic`, `strokePolyline`
- `strokeCircle`, `strokeEllipse`, `strokeRoundRect`
- `strokePath` for a `GfxPath`, and `strokePath2D` for a registered `Path2D`

`fillAndStrokeRoundRect`, `fillAndStrokeCircle` and `fillAndStrokeEllipse` draw a fill and a border in one call. A translucent border then blends against the fill once, and does not blend over it a second time.

`shadowRoundRect`, `shadowCircle` and `shadowPath2D` draw drop shadows. `drawImage` draws an image, and `fillText` draws a line of text. See [Text](/guides/text) for text.

Text and small images go through a shared label page. They are rasterized for the scale the node is drawn at when the picture replays, so zooming a node does not repaint its picture. `drawImage` takes `{ smoothing: false }` for nearest filtering, for pixel art.

`fillPath2D`, `strokePath2D` and `shadowPath2D` need a `Path2D` with a registered tessellation. {@link parseSvgPaths} registers one for every path it returns, and {@link registerPathTessellation} registers one by hand. A `Path2D` without one draws nothing. See [Assets](/guides/assets).

### Transform, alpha and blend

`save` and `restore` bracket a change to the transform, alpha, blend or clip. `translate`, `rotate`, `scale` and `transform(a, b, c, d, e, f)` multiply onto the current transform, as in Canvas 2D.

```ts
override paint(canvas: Canvas): void {
  for (const card of this.cards) {
    canvas.save()
    canvas.translate(card.x, card.y)
    canvas.rotate(card.tilt)
    canvas.setAlpha(card.fade)
    this.paintFace(canvas)
    canvas.restore()
  }
}
```

Inside `paint` these calls change the recorded geometry, not the node's `transform`. The engine applies the node's own transform and alpha when it replays the picture.

[`setAlpha`](/module/scene/canvas#setalpha) is relative to the node. It multiplies into the alpha the node gets from its own `transform.alpha` and its ancestors. A picture drawn at `setAlpha(0.5)` under a node at alpha 0.5 draws at 0.25. Within one picture a later `setAlpha` replaces an earlier one, like `globalAlpha`.

[`setBlend`](/module/scene/canvas#setblend) takes `'source-over'` (the default) or `'lighter'` (additive). Any other mode draws as `'source-over'` and logs one warning per mode. For other blend modes on a whole node, see [Groups, blends and mattes](#groups-blends-and-mattes).

### Paths that change

A {@link GfxPath} is a path you build in code and can edit at any time. It needs no registration, and `clear()` keeps its storage, so refilling it allocates nothing. Every edit increases its `version`. `fillPath` and `strokePath` record the path as a dependency, so editing it repaints the node that drew it.

```ts
import { GfxPath, Node2D } from '@src/stargazer'
import type { Canvas } from '@src/stargazer'

const blob = new GfxPath()
blob.moveTo(0, 0)
blob.cubicTo(40, -30, 90, -30, 120, 0)
blob.cubicTo(150, 40, 60, 80, 0, 50)
blob.close()

class Blob extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.fillPath(blob, '#7cc4ff')
    canvas.strokePath(blob, { color: '#ffffff', width: { screen: 3 } })
  }
}
```

`fillPath` takes a fill rule, `'nonzero'` (the default) or `'evenodd'`, as in Canvas 2D. A star drawn as one self-crossing outline fills solid under `'nonzero'`. Under `'evenodd'` it has a hole in the middle.

A convex path, such as a rectangle or a circle, fills with one draw that batches with its neighbors. Any other path uses the stencil buffer. It costs two draws and covers its bounding box, so a large concave path costs about as much fill rate as its bounding box. Winding is counted modulo 16. Sixteen contours wound the same way over one point cancel out, and `fillPath` warns once when a nonzero fill has 16 or more contours.

A surface without a stencil buffer cannot resolve overlap. `fillPath` then fills even-odd whatever the rule, and warns once. The stage's main surface has a stencil buffer. See [Combined depth and stencil](/combined-depth-stencil) for the bit layout.

`strokePath` cuts a `dash` pattern of any length on the CPU, starting `dashOffset` into the pattern. It strokes each dash with the style's caps, so a dashed path costs one stroke per dash. With a gradient color or `exactJoins: true`, `strokePath` draws the stroke as one filled shape, so sharp bends never fold over themselves. That shape honors `cap`, `join` and `miterLimit`.

Call `release()` on a `GfxPath` when its owner is destroyed.

### Gradients

A linear gradient (`GfxLinearGradient`) works on every fill call that takes a fill and on a stroke's `color`. Its axis runs from `(x0, y0)` to `(x1, y1)` in the current local space. A point at the start reads `stops[0]`, and a point past the far end reads the last stop, as in CSS `linear-gradient`.

A radial gradient (`GfxRadialGradient`) has `kind: 'radial'`, a center, a radius and an optional focal point.

```ts
canvas.fillPath(blob, {
  kind: 'radial',
  cx: 60,
  cy: 60,
  r: 60,
  fx: 45,
  fy: 45,
  stops: [
    { offset: 0, color: '#ffffff' },
    { offset: 1, color: '#2255ff' },
  ],
})
```

Offset 0 is at the focal point and offset 1 is on the circle. A focal point on or outside the circle is pulled just inside. The circle is in the current local space, so under a rotation, a skew, or an uneven scale its rings are ellipses, as with a CSS or SVG gradient under the same transform.

A radial gradient works on `fillRect`, `fillPath`, `fillConvexPoly`, `fillPath2D`, and a `strokePath` border. `fillRoundRect` and `fillCircle` draw it as its middle stop in one flat color, and warn once. A gradient stroke on `strokeCircle`, `strokeRoundRect` or the border of a fill-and-stroke call draws in the gradient's first stop.

{@link cssLinearGradient} builds the linear gradient that CSS `linear-gradient(<angle>, ...)` paints over a box, so a design given in CSS carries over directly.

```ts
import { cssLinearGradient } from '@src/stargazer'

// linear-gradient(75deg, #ffeb49 -30%, #ff6600 120%) on a 330 by 330 box
const fill = cssLinearGradient(330, 330, 75, [
  { offset: -0.3, color: '#ffeb49' },
  { offset: 1.2, color: '#ff6600' },
])
canvas.fillRect(0, 0, 330, 330, fill)
```

The angle follows CSS: `0` runs bottom to top and `90` runs left to right. Offsets are the CSS positions as fractions, and like CSS positions they may lie before `0` or past `1`.

All gradients in a frame share one small ramp texture. Ten gradient fills cost ten draws for the ten shapes, and no extra texture binds. Reuse one `stops` array across frames, for example a module-level constant, so the ramp row is found without rebuilding its key from a new array.

### Borders: alignment and exact joins

A stroke is centered on its path by default, half inside and half outside. Set `align` to move it.

```ts
canvas.strokeRoundRect(0, 0, 240, 140, 16, {
  color: '#1d1d2b',
  width: 3,
  align: 'outside',
})
```

The values are `'center'` (the default), `'inside'` and `'outside'`. On `strokeRoundRect` and `strokeCircle`, alignment only offsets the distance field, so it costs nothing extra.

On `strokeLine`, `strokeQuadratic`, `strokePolyline` and `strokePath2D`, three things switch the stroke to the outline renderer: a non-center `align`, `exactJoins: true`, or a gradient `color`. The outline renderer builds the border as one filled shape with exact miter, round or bevel joins and caps. The default renderer draws one piece per segment with round caps and no join geometry. Adjacent pieces overlap enough to cover a gentle bend.

```ts
canvas.strokePolyline(points, count, {
  color: '#1d1d2b',
  width: 3,
  join: 'miter',
  miterLimit: 4,
  exactJoins: true,
})
```

`miterLimit` defaults to 4, which is the SVG default. Canvas 2D uses 10.

A non-center `align` needs a closed contour with a clear winding. An open polyline has no inside, and a zero-area shape has no winding to read. Either one falls back to `'center'` with a one-time console warning.

The outline renderer caches the outline of a `strokePath2D` call per path, keyed by the style and a half-octave scale bucket. A zoom then builds the outline again only a few times. `strokePolyline`, `strokeLine` and `strokeQuadratic` outlines are not cached. Register a `Path2D` if you need a cached aligned border. The outline renderer ignores `dash`.

A short segment or a sharp inner corner can make the outline overlap itself. Under a translucent border this shows as a slightly darker patch at that corner. A round join, or a longer segment, avoids it.

### Drop shadows

A rectangle, rounded rectangle or circle gets an analytic shadow from `shadowRoundRect`, `shadowCircle`, or `ShapeNode`'s `shadow` option. An analytic shadow needs no render target and no cache, and costs the same every frame.

```ts
canvas.shadowRoundRect(0, 0, 240, 140, 16, {
  color: 'rgba(20, 16, 40, 0.35)',
  offsetY: 8,
  blur: 32,
})
canvas.fillRoundRect(0, 0, 240, 140, 16, '#1c1c22')
```

The style is `GfxShadowStyle`. `offsetX`, `offsetY`, `blur` and `spread` are lengths in the node's local units. `blur` is the CSS blur radius, and the shadow's Gaussian sigma is half of it. `inset: true` draws the shadow inside the shape, as CSS `box-shadow` does with `inset`. A shadow that should keep its size on screen at any zoom multiplies its lengths by `canvas.screenScale()`.

An analytic shadow's corners are circular. A smooth-cornered shape's shadow uses the circular radius that cuts the same area off each corner, which matches a blurred smooth corner once the blur is at least 0.6 of the radius at the iOS smoothing, and the whole radius at full smoothing. With less blur, the shadow's corners look rounder than the shape's.

`ShapeNode` draws in CSS order: outset shadows, then the fill, then inset shadows, then the border. An outset shadow is cut out from under the shape, so a translucent fill does not show the shadow through itself.

`Path2DNode`'s `shadow` option draws through `shadowPath2D`. A path has no closed-form distance, so the renderer rasterizes the path once into a small mask, blurs it, and reuses it every frame. The bake runs before the next frame, so a new shadow shows a nearby cached mask or a hard unblurred copy for its first frame. An inset shadow with no mask is skipped.

Offset can animate without a new bake. Blur and spread cannot. With `strokeSpace: 'screen'` the blur changes in local units on every frame of a zoom, which bakes a new mask each frame. Use `strokeSpace: 'world'` for a path shadow on a node the camera zooms. See [Path shadows](/path-shadows) for the cache, its budgets and its key.

### Path clips and bitmap masks

The `Canvas` has three clips. `setClip` handles a circle or a rounded rectangle. [`clipPath`](/module/scene/canvas#clippath) handles any `GfxPath`. [`setClipMask`](/module/scene/canvas#setclipmask) samples a {@link BitmapMask}.

A `setClip` shape keeps the local space it was set in, together with the transform. Each pixel is measured against it there. A circle clip under an uneven scale becomes the matching ellipse. The shape, fill, text and image draws read the clip per primitive, so changing the clip does not end their batch. Strokes, gradient programs, shader quads and path shadows read the clip in device space. That approximates a circle under an uneven scale and a rounded rectangle under rotation, and a clip change ends their batch.

`clipPath(path, rule?)` limits every following draw to the inside of a `GfxPath`, exactly per pixel under any transform. `restore()` undoes it. Clips nest, each one narrowing the last.

```ts
canvas.save()
canvas.clipPath(blob)
canvas.fillRect(0, 0, 400, 400, '#7cc4ff')
canvas.restore()
```

Only the part of the rectangle inside `blob` is drawn. A path clip uses the stencil buffer. It costs two extra draws to set up and one to undo, and every draw inside it tests the stencil. Nesting stops at 7 levels, and a deeper clip is ignored with a warning. A surface without a stencil buffer ignores `clipPath` and warns once. A path clip combines with `setClip`.

`setClipMask(mask)` masks by a `BitmapMask`'s alpha. It masks fills only, not strokes or text, and it uploads the mask as a texture. Use it only when the shape cannot be a circle, a rounded rectangle or a path.

A node's `clip` works on the whole subtree. A rectangle `clip` on an axis-aligned node clips in the shader and costs no draw. A path clip, a rectangle clip inside another clip, and a clip on a rotated node use the stencil.

### Groups, blends and mattes

Inside one picture, a translucent group fades per draw. Alpha multiplies into each draw separately, so overlapping parts show through each other.

A subtree that must fade as one flat image sets [`compositeGroup`](/module/scene/node2d#compositegroup) to `true` on its root node. The engine draws the node and its subtree into an offscreen surface, then composites the surface once with the node's cascaded `alpha`. Each group costs a surface for the frame, rendered in its own pass before the main pass. Use it only where parts overlap while translucent. A group that holds an inset view fades per draw instead.

[`compositeBlend`](/module/scene/node2d#compositeblend) sets how a node composites into what is under it. Any value other than `'source-over'` makes the node a group. The supported modes are `'source-over'`, `'lighter'`, `'screen'`, `'multiply'`, `'destination-out'`, `'destination-in'` and `'xor'`. Any other mode composites as `'source-over'` and warns once.

[`matte`](/module/scene/node2d#matte) takes another node whose drawing scales this one's, as a track matte. The engine draws the node and its subtree into one surface, and the matte node and its subtree into another over the same area. The node then composites through the matte by [`matteMode`](/module/scene/node2d#mattemode): `'alpha'`, `'inverted-alpha'`, `'luma'` or `'inverted-luma'`.

```ts
import { ShapeNode } from '@src/stargazer'

const reveal = new ShapeNode({
  geometry: { kind: 'circle', radius: 80 },
  fill: '#ffffff',
})
photo.matte = reveal
photo.matteMode = 'alpha'
parent.add(reveal, photo)
```

`photo` shows only inside the circle. The matte node is not drawn on its own. It usually sits next to the node it serves, so both share the parent's transform. A hidden matte is empty, which hides the node, or shows all of it with an inverted mode.

A mask made of several shapes is a matte whose children are groups with `compositeBlend` set. `'destination-out'` subtracts a shape from the coverage so far, `'destination-in'` intersects with it, and `'xor'` keeps what lies in only one of them.

These groups use the renderer-level {@link Gfx2D} calls `beginOffscreen` and `endOffscreen`. The `Canvas` a node paints into has no offscreen calls, so a picture cannot open a surface itself.

### Layers

A {@link Layer} is a node that gives its subtree its own placement, its own post-processing effects, or a kept render. It draws through the same kind of surface a group uses.

```ts
import { Layer } from '@src/stargazer'

const hud = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
})
scene.root.add(hud)
hud.add(scoreLabel)
```

The layer fits a 1920 by 1080 frame into the canvas and ignores the camera, so `scoreLabel` stays put while the camera pans. [`space`](/module/scene/layer#space) is `'world'` (the default), `'screen'`, or `{ frame }`.

[`effects`](/module/scene/layer#effects) runs post-processing over the layer's subtree only. See [Post-processing](/guides/post-processing). A layer draws without its effects while their pipelines compile, and when it holds an inset view or sits inside one.

[`cache: 'raster'`](/module/scene/layer#cache) keeps the layer's rendered result and draws it again as one textured quad while nothing under the layer changes. The layer renders again when a node under it moves, changes visibility or alpha, repaints, or is added or removed. It also renders again when an effect's parameters, the canvas, the view or the region change. Call [`invalidate()`](/module/scene/layer#invalidate) for a change that none of these cover. A node under the layer that draws with `draw` instead of `paint` makes the layer render every frame.

### Custom shaders

[`canvas.drawShaderQuad(quad, x, y, w, h)`](/module/scene/canvas#drawshaderquad) draws a rectangle with your own shader. Use it when one fragment shader can stand in for many shapes, such as a field of dots or a procedural fill. Drawing each shape separately would cost a draw record each.

```ts
import { DataTexture, Node2D, ShaderQuad, quadShader } from '@src/stargazer'
import type { Canvas } from '@src/stargazer'

const shader = quadShader(vertGlsl, fragGlsl, wgsl, reflection)
const cells = new DataTexture(cols, rows)
const quad = new ShaderQuad({ shader, paramsBytes: 32, textures: [cells] })

class Field extends Node2D {
  override paint(canvas: Canvas): void {
    canvas.drawShaderQuad(quad, 0, 0, width, height)
  }

  override onUpdate(): void {
    quad.params[0] = cols
    cells.data[i * 4] = 200
    cells.markDirty()
  }
}
```

The picture holds the quad by reference. Each replay draws it with the params and texture contents as they are at that moment, so changing them does not repaint the node.

The current transform (rotation included), `setAlpha`, `setBlend`, `setClip` and `clipPath` apply. `setClipMask` does not, so a shader that needs a bitmap outline samples it itself. Nothing draws until the quad's pipelines finish compiling. `ShaderQuad` takes at most 4 textures and 256 bytes of params.

#### The shader contract

Write one WGSL module with `vs_main` and `fs_main`. Run `npm run gen:shaders` to generate the GLSL and the reflection file beside it. The module declares these bindings and inputs:

- Group 0, binding 0 holds the shared `Frame` block, and binding 8 holds the `Clip` block. Copy the `Frame` struct from an existing shader such as `render/gfx/shaders/maskedRadialGradient.wgsl`, and the `Clip` struct, `clipCoverage` and the distance helpers it calls from `render/gfx/shaders/include/clipUniform.inc.wgsl` and `sdf.inc.wgsl`.
- Vertex input `a_unit` at location 0 is the quad's corner in `0..1`. `a_originAxisX` at location 1 is a `vec4` with the origin in device pixels and the x edge vector. `a_axisYAlpha` at location 2 holds the y edge vector, then the draw's alpha.
- Group 1, binding 10 is a `Params` uniform block, written from `quad.params`.
- Group 1, bindings 0 to 3 are up to four textures, each a `DataTexture`.

The vertex shader places the corner at `origin + axisX * unit.x + axisY * unit.y`, projects it with `frame.proj`, and passes `unit` on as the quad's UV.

Each draw takes a snapshot of `params`. A `DataTexture` is different. Its uploads are not ordered against draws already recorded in the frame, so every draw that samples it sees the contents as they were when the last of those draws was recorded. Write a texture once per frame, before drawing with it.

### Pixel snapping

The engine has two tools for crisp pixels, one for sizes and one for positions.

[`canvas.snap(length)`](/module/scene/canvas#snap) rounds a local length to a whole number of device pixels at the scale the node is drawn at. It marks the picture as depending on scale. Use it on sizes, not positions. A grid of equal cells then loses the cell-to-cell width differences that look like aliasing, and the block keeps one shared subpixel offset, so it still slides smoothly.

```ts
override paint(canvas: Canvas): void {
  const cell = canvas.snap(this.boxWidth / 16)
  for (const run of this.runs) {
    canvas.fillRect(
      run.x * cell,
      run.row * cell,
      run.len * cell,
      cell,
      run.color,
    )
  }
}
```

The picture repaints once the scale stops at a new value, because a snapped length rounds differently at each scale.

[`pixelSnap`](/module/scene/node2d#pixelsnap) set to `true` on a node rounds the node's origin to a whole device pixel when it is drawn. It moves the node by less than half a pixel and never repaints. Sharp edges and nearest-filtered images then land on pixel boundaries at rest.

### Bounds and culling

A node's [`bounds`](/module/scene/node2d#bounds) is the local box of what its picture drew. The canvas works it out while recording, so ordinary drawing needs no setup. The engine uses bounds to skip a node whose world box is outside the view, for the default `hitTest`, and for the debug outline. Screen-width strokes and shadows reach a little past the box, and culling and hit testing allow for that.

A picture whose extent is unknown has no bounds, and it draws every frame wherever the camera is. `fillPath2D`, `strokePath2D` and `shadowPath2D` make a picture unbounded, because a `Path2D` has no bounds of its own. This is a common reason a scene stays slow after zooming in. Set [`boundsOverride`](/module/scene/node2d#boundsoverride) to the local box to fix it.

```ts
import { Node2D } from '@src/stargazer'

class Panel extends Node2D {
  constructor() {
    super()
    this.boundsOverride = { x: 0, y: 0, width: 200, height: 24 }
  }
}
```

`boundsOverride` replaces `bounds` for hit testing and the debug outline. Culling uses it together with the picture's bounds, so a node never disappears while part of what it paints is still in view. A container with no picture of its own sets it to take taps over a region. `Path2DNode` takes the box as its `bounds` option.

### Immediate drawing with `draw`

A `Node2D` that has no `paint` method can override [`draw(gfx, camera, dt)`](/module/scene/node2d#draw) instead. The engine calls `draw` every frame with a `Gfx2D`, and records nothing. Use `paint` wherever you can. A `draw` node has no picture bounds, so it is never culled unless it sets `boundsOverride`, and it makes a cached `Layer` above it render every frame.

### Keeping the batch intact

When a picture replays, its draws are appended to per-program buffers. At the end of the frame the renderer submits them in painter order. A change of program, texture or blend mode starts a new batch. Alpha, color and transform do not, because they are stored per instance. The renderer also merges runs of the same program and state when no draw between them overlaps them, so interleaving programs does not stop their draws from batching.

The `shape` program (rects, rounded rects, circles, text, small images and atlas sprites) and the `coloredTri` program (fills) store the clip as an index per primitive. Changing the clip does not end their run. Strokes, gradient programs, shader quads and path shadows still start a new batch on a change of clip.

The buffers grow when a frame needs more room and halve again after 60 frames under a quarter full. The renderer never drops a draw for lack of room. A scene with thousands of separate runs pays in upload bytes and uniform slices, which the debug HUD shows.

A few habits keep batches long:

- Fade with alpha, not color. A node's `alpha` and `setAlpha` are stored per instance, and a fade never repaints. Writing a new color string repaints the node, and for text it rasterizes the label again.
- Don't build color strings per object in `paint`. {@link mixColor} and {@link withAlpha} return new strings. Call them once at module load. To cross-fade many things, draw the old color and then the new one under `setAlpha`.
- Don't draw a translucent shape in two overlapping parts, such as a plus sign made of two bars. The overlap blends twice and reads as a dark patch. Mix the color once with `mixColor(background, ink, amount)` to get an opaque color that looks the same. For the same reason, animate such a shape in by scaling its node, not by fading it.
- Group images by texture, not by object. Switching between images from different sources starts a new batch each time. Text, small images and atlas sprites share fixed texture units, so they interleave without breaking a batch.

A translucent stroke with several segments is the one case the engine fixes for you. It uses the stencil buffer so that the stroke paints each pixel once, and a dashed translucent polyline does not show beads at its joins. An outline-rendered border is one filled shape and needs no fix. A surface without a stencil buffer draws plain overlapping segments. The stage's surface keeps its stencil bits when a 3D pass adds depth, see [Combined depth and stencil](/combined-depth-stencil).

### What the renderer keeps

A picture at rest is replayed every frame. The renderer keeps on the GPU what it builds from the picture, so a still scene uploads little per frame. You don't ask for this. Something is kept once it is drawn the same way on two frames in a row, and only where keeping it costs no extra draw call.

The renderer keeps these:

- A stroke of 256 segments or more, from `strokePolyline` or a registered `Path2D`.
- The tessellation of a registered `Path2D` with a linear gradient fill or an inset shadow. Geometry with 1500 indices or more is kept from its first draw. `registerPathTessellation` takes `{ retained: true }` to keep smaller geometry too.
- The filled shape of a `strokePath` drawn with a gradient or `exactJoins`, and the outline of a registered `Path2D` stroke.
- The flattened form of a `GfxPath`, for the last few scales it was drawn at.
- Text and small images, in the label page.
- Path shadow masks.

A flat fill, or a gradient fill that shares its gradient with another fill, is not kept. It already draws in one call with its neighbors. Kept content is freed when it goes undrawn for a while, or when its cache passes its memory budget, and built again on its next draw.

These stop the renderer from keeping content:

- Repainting. A new recording frees what was kept for the old one.
- Moving every frame. A kept stroke is held in device pixels, so a node that moves, scales or rotates builds its strokes again each frame, even when its picture rests.
- Dashes, which are cut again on every draw.
- Editing a `GfxPath` every frame.

Paths that don't touch share draws. Several stencil-filled paths that sit apart cost one pass for their winding and one for their paint. Translucent strokes that sit apart share their three passes. Paths that overlap draw in order, each with its own passes.

### Reading the cost

`?debug=hud` opens the debug HUD. Its Rendering panel shows draw calls, repaints, upload bytes per frame, program switches, texture binds, blend switches, merged runs, uniform slices, instance counts and cache memory. The tooltip on the Uploaded card breaks the upload down by program and names the pictures that stream the most. A picture that uploads kilobytes every frame while it looks still is worth a look. The panel's Textures section shows the atlas and the label page.

A label page reset means every label in the scene was rasterized again in one frame. That is the most expensive thing the text cache does.

`?debug=perf` also wraps each node's update and draw in `performance` marks, so the browser profiler shows a per-node timeline. [`Engine.lastFrameWorkSec`](/module/engine/engine#lastframeworksec) is the CPU work inside the frame, not the time between frames. See [Debugging](/guides/debugging).

## See also

- {@link Canvas}: the recorder a node's `paint` draws into
- {@link Node2D}: `paint`, `clip`, groups, mattes and bounds
- {@link ShapeNode}: circles and rectangles with borders and shadows
- {@link Path2DNode}: SVG paths with borders, shadows and hit testing
- {@link GfxPath}: a path you build and edit in code
- {@link ImageNode}: an image drawn as a rectangle
- {@link squirclePath}, {@link squircleSvgPath}, {@link squirclePath2D}: smooth-cornered outlines
- {@link cssLinearGradient}: a linear gradient from CSS `linear-gradient` values
- {@link Layer}: placement, effects and a kept render for a subtree
- {@link definePaintProps}: properties that repaint a node when written
- [Scene graph](/guides/scene): the nodes that draw for you
- [Text](/guides/text): measuring, wrapping and the label cache
- [Assets](/guides/assets): SVG paths, tessellation and bitmap masks
- [Camera](/guides/camera): coordinate spaces and `screenScale`
- [Post-processing](/guides/post-processing): effects on the stage and on a layer
- [Path shadows](/path-shadows): how path shadow masks are baked and cached
- [Combined depth and stencil](/combined-depth-stencil): the stencil bit layout

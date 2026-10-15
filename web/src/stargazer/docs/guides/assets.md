---
title: Assets
group: Features
order: 11
---

# Assets

Art usually arrives as SVG or as an image. Stargazer can read an SVG as vector
paths with {@link parseSvgPaths}, or draw it to a bitmap with
{@link rasterizeSvg}. {@link AssetLoader} caches the result, so a scene that
loads again doesn't repeat the work.

Vector paths need one extra step before they render. The GPU renderer draws
triangles, so every `Path2D` it fills or strokes needs a registered
tessellation. `parseSvgPaths` registers one for you when you pass
`tessellate: true`.

## Basic usage

This example loads an SVG map once, then adds one region of it to a scene.

```ts
import { AssetLoader, Path2DNode, parseSvgPaths } from '@src/stargazer'

const assets = new AssetLoader()

await host.loadScene(async (scene) => {
  const map = await assets.load('map', async () => {
    const svg = await fetch('/map.svg').then((r) => r.text())
    return parseSvgPaths(svg, { tessellate: true })
  })
  const north = map.paths.get('north')
  if (north) {
    scene.root.add(new Path2DNode({ path: north.path, fill: '#88c' }))
  }
})
```

The first `load` of `'map'` runs the factory. Every later `load` of that key
returns the same promise, even after the scene is replaced. Create the loader
outside the scene builder, once per app, so it outlives scene changes.

### Read paths from an SVG

`parseSvgPaths(svgText, options)` reads every `<path>` in an SVG string. It
returns a {@link SvgPathMap}: the SVG's `viewBox` and a map from key to
{@link SvgPathEntry}. The SVG's own fills and strokes are ignored. Set the
colors on the node that draws the path.

Each path gets its key this way:

1. A `<path>` with an `id` uses that id.
2. Otherwise the nearest ancestor element with an `id`, usually a `<g>`, gives
   the key. All paths under that ancestor merge into one `Path2D`, with bounds
   that cover them all. This is how a shape made of several pieces is usually
   drawn.
3. A path with neither gets `path-<index>`.

Each entry has `path`, a `Path2D`, and `bounds`, its axis-aligned bounds. With
`tessellate: true` it also has `contours` and `triangles`.

### Draw an SVG as a bitmap

Use `rasterizeSvg` for artwork that should keep its own colors, such as a
detailed illustration or an icon. It returns a canvas that you draw with
[`drawImage`](/module/scene/canvas#drawimage) or an {@link ImageNode}.

```ts
import { rasterizeSvg } from '@src/stargazer'

const icon = await assets.load('coin', () =>
  rasterizeSvg(coinSvg, { scale: 4 }),
)

// In a paint method:
canvas.drawImage(icon, 0, 0, 32, 32)
```

`scale` is a multiple of the SVG's `viewBox` size. Pass `width` and `height`
instead to set the pixel size directly. Rasterize at least at the largest size
the image will appear on screen.

Use paths for flat vector shapes. Paths stay sharp at any zoom, batch with
other fills, and use no texture memory. Use a bitmap when the art has its own
colors, gradients or detail that you don't want to rebuild as nodes.

## Advanced usage

This section covers how path tessellation works and how to register paths you
build in code, then SVG options, bitmap masks, textures for 3D meshes, and
which assets stages can share.

### Why paths need tessellation

The GPU renderer can't triangulate a `Path2D` when it draws, because a browser
`Path2D` doesn't expose its path data. So `fillPath2D` and `strokePath2D` look
up a tessellation registered in advance. **A path with no registration draws
nothing.** It doesn't throw or warn. Each skipped call adds to a counter that
the debug HUD shows.

The same applies to everything else that reads the registration. A
{@link Path2DNode} drop shadow reads the triangles, and a stroke of any
alignment reads the contours. If a path renders as nothing at all, check its
registration first.

### Register a path built in code

For a `Path2D` you build yourself, flatten the path data to contours,
triangulate them, and register the result with the path.

```ts
import {
  flattenSvgPath,
  registerPathTessellation,
  tessellateContours,
} from '@src/stargazer'

const d = 'M0 0 L40 0 L40 40 Z'
const contours = flattenSvgPath(d, 0.5)
const path = new Path2D(d)
registerPathTessellation(path, tessellateContours(contours), contours)
```

{@link registerPathTessellation} takes these arguments:

- `path`: the `Path2D` the renderer will be given.
- `geometry`: the triangles from {@link tessellateContours}.
- `contours`: the flattened outlines. `strokePath2D` walks them, so pass them
  whenever the path is stroked.
- `closed`: one flag per contour. The default is `true` for every contour,
  which matches SVG shapes that end in `Z`. Pass `false` for an open curve, or
  `strokePath2D` draws a closing segment that isn't there.
- `opts.retained`: keep the triangles in GPU buffers. See below.

The second argument of {@link flattenSvgPath} is the flattening tolerance, in
the path's own units. `tessellateContours` uses 16-bit indices and throws for a
shape with more than 65,535 vertices.

Registrations are stored per `Path2D` object and go away when the path is
garbage collected. {@link getPathContours} reads back the registered contours,
and {@link releasePathTessellation} drops a registration early.
Registering the same path again replaces its tessellation.

For geometry that changes every frame, {@link flattenQuadratic} and
{@link flattenCubic} subdivide one Bézier curve into a buffer you own. They
allocate nothing, so they are safe to call while drawing.

### Holes and hit testing

`tessellateContours` nests contours with the even-odd rule. A contour inside an
odd number of other contours is a hole in the one around it. The winding
direction doesn't matter, because SVG exporters don't apply it consistently.

{@link Path2DNode} uses the same rule for `hitMode: 'fill'`, so a tap inside a
hole misses the shape. A path drawn by hand with overlapping regions that
should both fill (the nonzero rule) gets holes where they overlap instead. The
engine doesn't read the SVG's `fill-rule`.

### Retained geometry

Geometry with 1500 or more triangle indices stays in static GPU buffers from its
first draw. Each frame then draws it with a model matrix instead of
transforming every vertex on the CPU. A large map crosses that threshold and a
small icon doesn't. Smaller geometry is kept on the GPU only when it already
draws as a batch of its own. Pass `{ retained: true }` or `{ retained: false }`
as the fifth argument of `registerPathTessellation` to choose yourself.

### SVG path options

{@link ParseSvgPathsOptions} has three options:

- `tessellate` (default `false`): triangulate each path and register it.
- `flattenTol` (default `0.5`): how far a flattened curve may stray from the
  real curve, in output units.
- `scale` (default `1`): multiply every path, its bounds and the `viewBox` by
  this factor. Use it to read two drawings at different sizes on one scale.

`parseSvgPaths` throws when the text isn't valid XML or has no `<svg>` root.

Two helpers measure a tessellated shape. {@link deepestInteriorPoint} returns
the point inside the contours that is farthest from every edge, a good spot for
a label or marker. `interiorThickness(entry)` returns the shape's mean width,
`2 * area / perimeter`.

### Bitmap options

{@link RasterizeSvgOptions} has `scale`, `width`, `height` and `timeoutMs`
(default 3000). Without a `viewBox`, the SVG is treated as 64 by 64.

`rasterizeSvg` never rejects. When there is no 2D context or the decode fails,
it returns a blank canvas of the right size and logs a warning.
{@link isBlankRaster} tells you that happened, for example in a test
environment that can't decode images.

{@link svgViewBoxSize} reads the `viewBox` size from SVG text, so you can lay
out the bitmap at its natural aspect ratio. {@link sizeSvgSource} writes a
width and height onto the root element.

A canvas from `rasterizeSvg` is sampled with one bilinear lookup when drawn. A
bitmap drawn at a third of its size loses most of its detail, so rasterize
close to the size it will be drawn at.

### Bitmap masks

`buildBitmapMask({ path, worldRect })` fills a path into a pixel mask and
returns a {@link BitmapMask}. Its `contains(worldX, worldY)` answers whether a
point is inside the shape with one array lookup. Use a mask for two things:

- Boundary tests, such as whether a piece is inside the play area. With a
  third argument, `insetWorld`, `contains` also tests four points that distance
  away and returns `true` only if all are inside. This keeps the soft edge of
  the mask from counting as inside.
- Clipping. Pass the mask to [`setClipMask`](/module/scene/canvas#setclipmask)
  to crop draws to the shape. For a circle or rounded rectangle, use
  [`setClip`](/module/scene/canvas#setclip) instead. See
  [Drawing](/guides/drawing).

{@link BitmapMaskOptions} sets `resolution`, the longest edge in pixels
(default 1024), and `alphaThreshold`, the alpha above which a pixel counts as
inside (default 128). Building a mask reads pixels back from a canvas, which
can stall on a GPU-backed canvas, so the function is async. Build masks while
loading, not during play. `dispose()` releases a mask.

### Textures for 3D meshes

`createTexture(source, options)` turns a canvas or an `ImageBitmap` into a
{@link MaterialTexture} for a {@link MeshNode} material. With `rasterizeSvg`, it
puts vector art on a mesh without a glTF file.

```ts
import {
  MeshNode,
  createQuadGeometry,
  createTexture,
  rasterizeSvg,
} from '@src/stargazer'

const quad = createQuadGeometry({ width: 2.5, height: 3.5 })
const face = await createTexture(await rasterizeSvg(cardSvg, { scale: 2 }))
const card = new MeshNode(quad, {
  lit: true,
  pbr: true,
  color: [1, 1, 1, 1],
  baseColorTex: face,
})
```

{@link CreateTextureOptions} has three options:

- `srgb` (default `true`): right for base color and emissive art. Normal,
  metallic-roughness and occlusion maps hold linear data and need `false`.
- `mipmap` (default `true`): turn it off for albedo with an alpha cutout, where
  filtering softens the cut edge.
- `wrap` (default `'clamp'`): `'clamp'` or `'repeat'`.

The renderer shares GPU textures by {@link TextureImage} identity. Create one
texture per picture and give it to every mesh that shows it.

`createTexture` resolves as soon as the pixels can be uploaded. For a canvas
source, it also encodes a PNG copy in the background, which the renderer uses to
rebuild the texture after a GPU context loss. {@link textureFromImageBitmap} is
the synchronous form for a bitmap you already have. It keeps no copy, so its
texture doesn't come back after a context loss. Passing an `ImageBitmap` to
`createTexture` behaves the same way. The renderer closes the bitmap after
uploading it, so don't use it afterwards.

glTF models load through {@link loadGltf}. See [3D](/guides/3d).

### Sharing across stages

A `Path2D`, a `BitmapMask` and an image hold no GPU handles, so one instance can
back nodes on any number of stages. Tessellation registrations are global for
the same reason. Each stage owns its nodes, not the assets.

### Fonts

The browser shapes text from a CSS font string, and the engine can't load a
font face for you. Load every face before the first frame. See
[Text](/guides/text).

## See also

- {@link AssetLoader}: cache a load by key
- {@link parseSvgPaths}: read an SVG as paths
- {@link registerPathTessellation}: register a path built in code
- {@link rasterizeSvg}: draw an SVG to a canvas
- {@link buildBitmapMask}: a pixel mask for boundary tests and clipping
- {@link createTexture}: a texture for a 3D material
- {@link Path2DNode}: draw a path in the scene
- [Drawing](/guides/drawing): fills, strokes and clipping
- [3D](/guides/3d): meshes, materials and glTF
- [Text](/guides/text): fonts and labels

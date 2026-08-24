# Assets

Art arrives as SVG or as an image. This covers turning it into something the
engine can draw, caching that work so a scene reload does not repeat it, and the
one registration step vector paths need before they render.

## Loading once

`AssetLoader` is a keyed async cache. Register a factory per key and every later
`load` of that key returns the same memoized promise, so parsing artwork costs
once even across scene swaps. A factory that rejects is evicted, so the next
call retries.

```ts
import { AssetLoader, parseSvgPaths } from '@src/stargazer'

const assets = new AssetLoader()

await host.loadScene(async (scene) => {
  const map = await assets.load('map', async () => {
    const svg = await fetch('/map.svg').then((r) => r.text())
    return parseSvgPaths(svg, { tessellate: true })
  })
  // ...build nodes from map.paths
})
```

Keep the loader outside the scene builder. One per app or per display, not one
per scene.

## SVG to paths

`parseSvgPaths(svgText, opts)` pulls every `<path>` out of an SVG string and
returns a `Path2D` per key plus the source `viewBox`. Fills and strokes in the
SVG are ignored, so color the result at render time on the node.

Keys resolve in three steps. A `<path>` with its own `id` uses that. Otherwise
the nearest `<g id="...">` ancestor supplies the key, and every sibling path
under that group merges into one `Path2D` with a union AABB, which is how a
multi-region feature is usually authored. A path with neither gets
`path-<index>`.

```ts
const { viewBox, paths } = parseSvgPaths(svgText, { tessellate: true })

const france = paths.get('france')
if (france) {
  scene.root.add(
    new Path2DNode({ path: france.path, fill: '#88c', hitMode: 'fill' }),
  )
}
```

Each entry carries `path`, `bounds` (its local AABB), and, with `tessellate: true`,
`contours` and `triangles`.

## Tessellation is not optional

The GPU renderer draws triangles. It cannot triangulate a `Path2D` at draw time,
because the path's `d` string is not recoverable from the object at runtime. So
`fillPath2D` and `strokePath2D` look up a pre-registered tessellation, and a path
without one **draws nothing**. No error, no throw. The call ticks a counter the
debug HUD reports.

Passing `tessellate: true` to `parseSvgPaths` registers every path it parses,
which covers artwork loaded from a file. Use it wherever it fits.

A `Path2D` built in code registers itself. Flatten the geometry to contours,
triangulate them, and bind the result to the path:

```ts
import {
  flattenSvgPath,
  tessellateContours,
  registerPathTessellation,
} from '@src/stargazer'

const d = 'M0 0 L40 0 L40 40 Z'
const contours = flattenSvgPath(d, 0.5)
const path = new Path2D(d)
registerPathTessellation(path, tessellateContours(contours), contours)
```

The third argument is what `strokePath2D` walks, so pass it whenever the path
will be stroked as well as filled. A fourth argument takes a per-contour
`closed` flag, which defaults to true because SVG shape paths end in `Z`. Pass
`false` for an open curve, or `strokePath2D` emits a closing segment that is not
there.

For geometry built per frame rather than per load, `flattenQuadratic` and
`flattenCubic` subdivide a single Bézier into a buffer you own, with no
allocation, so they are safe on the render path. `getPathContours(path)` reads
back what was registered, and `releasePathTessellation(path)` drops it, which a
node that registers a one-off retained path should call on teardown.

Large, long-lived geometry auto-opts into a retained upload: the triangles go to
static GPU buffers once and each frame draws them with a model matrix, rather
than transforming every vertex on the CPU. The threshold is 1500 indices, which
a map crosses and a glyph does not. Nothing to configure.

If a path renders as nothing at all, tessellation is the first thing to check.

## SVG to a bitmap

`rasterizeSvg(svgText, opts)` decodes an SVG through an `<img>` and draws it to a
canvas, for artwork that should be a texture rather than geometry: a detailed
illustration, an icon drawn through `gfx.drawImage`, a particle sprite. Size it
with `scale` (a multiple of the `viewBox`) or with explicit `width` and
`height`.

`svgViewBoxSize` reads the intrinsic size out of the source, and
`sizeSvgSource(svg, w, h)` stamps a width and height onto the root element so
the decode lands 1:1. An SVG with no intrinsic size lets the browser pick one.

`isBlankRaster(canvas)` reports a decode that produced nothing, which is how a
headless test environment behaves.

Prefer paths over rasters where the art is flat vector shapes. Paths stay sharp
at any zoom, batch with every other fill, and cost no texture memory.

## A texture for a 3D material

`createTexture(source, opts)` turns a canvas or an `ImageBitmap` into the
`MaterialTexture` a `MeshNode` material takes, which is how art gets onto a mesh
without going through a glTF file. It pairs with `rasterizeSvg`:

```ts
const face = await createTexture(await rasterizeSvg(cardSvg, { scale: 2 }))
const card = new MeshNode(quad, {
  lit: true,
  pbr: true,
  color: [1, 1, 1, 1],
  baseColorTex: face,
})
```

`srgb` defaults to true, which is right for base-color and emissive art. Normal,
metallic-roughness and occlusion maps carry linear data and want `srgb: false`.
`mipmap` defaults on, and wants turning off for alpha-MASK albedo, where
filtered edges eat the cutout.

The renderer dedupes GPU textures by `TextureImage` identity, so build one
texture per distinct picture and share it across every mesh that draws it,
rather than one per node.

It resolves as soon as the pixels are ready to upload. From a canvas source the
PNG re-encode that backs context-loss recovery finishes in the background, so
the first frame never waits on it. `textureFromImageBitmap` is the synchronous
form for a bitmap you already hold, and retains no source bytes, so a texture
built that way does not come back after a GPU context loss.

## Bitmap masks

`buildBitmapMask({ path, worldRect })` rasterizes a filled path and hands back a
mask with an O(1) `contains(worldX, worldY)` test. Two uses:

- Boundary tests. "Is this token inside the play area?" against an arbitrary
  shape, without a point-in-polygon walk. `insetWorld` samples a small band
  around the point and requires all of it inside, which keeps an anti-aliased
  edge from reading as inside.
- Clipping. Pass it to `gfx.setClipMask` to crop fills to the shape. See
  [Drawing](/guides/drawing#clipping), and prefer the analytic `setClip` for a
  circle or rounded rect.

It is async, because the pixel readback can stall on a GPU-backed canvas, so
build it during a load rather than mid-game. `resolution` (default 1024) sets the
longest edge, and `dispose()` releases it.

## glTF

3D models load through `loadGltf(url)`, which is covered in [3D](/guides/3d#loading-gltf).

## Sharing across stages

A `Path2D`, a `BitmapMask`, and an image are plain data with no device handles,
so the same instance can back nodes on any number of stages. Tessellation
registrations are process-wide for the same reason. Stages own nodes, not assets.

## Fonts are not assets

Text is shaped by the browser from a CSS font string, so the engine has no view
of font loading and cannot load a face for you. Loading every face before the
first frame is the host application's job, and getting it wrong mislays text
rather than merely restyling it. See [Text](/guides/text#webfonts).

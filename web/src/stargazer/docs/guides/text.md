# Text

Text draws through `Gfx2D.fillText`, either called directly inside a node's `draw` or through the `TextNode` wrapper. The renderer shapes the string with the platform Canvas 2D engine (kerning, ligatures, complex scripts, emoji), rasterizes the shaped line to a cached texture, and draws it as a quad, so a label stays sharp and cheap while it rotates or the camera zooms.

## Two ways in

- `Gfx2D.fillText(text, x, y, style?)` inside a node's `draw`, for a label the node paints itself (a live score, a coordinate readout).
- `TextNode`, a scene node you add to the tree; it holds the string and style and calls `fillText` for you each frame.

## fillText

```ts
override draw(gfx: Gfx2D): void {
  gfx.fillText('Score: 42', 0, 0, {
    font: '700 32px "Inter", sans-serif',
    align: 'center',
    baseline: 'middle',
    color: '#fff',
  })
}
```

`(x, y)` is the anchor in the node's local space. `align` places it horizontally, `baseline` vertically. The call draws one line and does not wrap. `GfxTextStyle`:

| Field      | Default           | Meaning                          |
| ---------- | ----------------- | -------------------------------- |
| `font`     | `10px sans-serif` | CSS font shorthand               |
| `align`    | `left`            | horizontal anchor for `x`        |
| `baseline` | `alphabetic`      | vertical anchor for `y`          |
| `color`    | `#000`            | CSS color, baked into the bitmap |

The color is part of the rasterized bitmap, not a shader tint, so a multi-color emoji keeps its own colors and any CSS color string works. `setAlpha` still applies on top, which is what makes fading a label in and out free (see caching below).

## TextNode

```ts
import { TextNode } from '@src/stargazer'

const label = new TextNode({
  text: 'Ready',
  x: 100,
  y: 40,
  fontSize: 24,
  color: '#fff',
})
scene.root.add(label)

label.text = 'Go' // every option is a public field; the next frame picks it up
```

| Option       | Default      | Meaning                                    |
| ------------ | ------------ | ------------------------------------------ |
| `text`       | (required)   | the string to draw (single line)           |
| `x`, `y`     | `0`          | anchor in local space                      |
| `fontFamily` | `sans-serif` | family or stack                            |
| `fontWeight` | `normal`     | CSS weight (`400`, `'700'`, `'bold'`)      |
| `fontSize`   | `16`         | size in `sizeSpace` units                  |
| `sizeSpace`  | `screen`     | `screen` (CSS px) or `world` (world units) |
| `color`      | `#000`       | CSS color                                  |
| `align`      | `left`       | horizontal anchor                          |
| `baseline`   | `alphabetic` | vertical anchor                            |

`sizeSpace` decides how `fontSize` reads, the same split `ShapeNode` uses for stroke width:

- `'screen'` (default): `fontSize` is CSS pixels, so the label holds a constant on-screen size as the camera zooms.
- `'world'`: `fontSize` is world units, so the label scales with the field.

## Sharpness

The label is rasterized at the resolution it occupies on screen. `fillText` reads the current transform, takes `deviceScale = max(hypot(a, b), hypot(c, d))` (the transform's scale, independent of any rotation), and rasterizes the canvas at `fontSize × deviceScale` device pixels. The quad then draws at the logical size, so texels map about 1:1 to pixels. An axis-aligned label also snaps its position to whole device pixels so the glyphs sit on the pixel grid.

## Caching and animation cost

Shaping the string in Canvas 2D and uploading the texture are the costs to keep off the per-frame path. Each label is cached, keyed by its text, font, alignment, baseline, color, and a scale bucket, under an LRU bound. What that buys:

- Rotation reuses the texture. `deviceScale` ignores rotation, so a spinning label rasterizes once and only its quad transform changes per frame.
- Screen-space labels never re-rasterize on zoom. Their device size is `fontSize × dpr` whatever the camera scale, so a zoom tween leaves the cache untouched. This is the common HUD case.
- World-space labels re-rasterize in steps. The scale rounds up to the next bucket, so panning through a zoom costs a few uploads rather than one per frame, and the label only ever samples down, which stays crisp, instead of upscaling, which blurs.
- Alpha is free; color is not. Alpha rides the quad tint. Color is baked into the bitmap, so animating it re-rasterizes on every frame the value changes. Prefer an alpha fade or a fixed color.

## Limits

- One line. No wrapping, no outline or stroke, no `maxWidth`.
- No mipmaps, so a world-space label zoomed far out softens under bilinear sampling.
- A very long string or an extreme zoom clamps the raster scale to stay within the GPU's max texture size, trading a little sharpness for not throwing.

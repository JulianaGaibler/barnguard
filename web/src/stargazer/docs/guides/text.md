---
title: Text
group: Features
order: 8
---

# Text

Stargazer draws text with the browser's Canvas 2D text engine, so kerning,
ligatures, complex scripts and emoji work as they do on a web page. The renderer
rasterizes each line once into a cached texture and draws it as a textured quad.
A label stays sharp and costs almost nothing while it moves, rotates or fades.

There are two ways to draw text. {@link TextNode} is a scene node that holds a
string and its style. [`fillText`](/module/scene/canvas#filltext) on a
{@link Canvas} draws one line from inside a node's `paint`. Read
[Drawing](/guides/drawing) first if you haven't written a `paint` method before.

## Basic usage

This example adds a label to the scene and changes it later.

```ts
import { TextNode } from '@src/stargazer'

const label = new TextNode({
  text: 'Ready',
  x: 100,
  y: 40,
  fontSize: 24,
  fontWeight: 700,
  color: '#fff',
})
scene.root.add(label)

label.text = 'Go'
```

The label's anchor sits at `(100, 40)` in the parent's space. By default the
anchor is the left end of the text's baseline. Every option is a public field.
Assigning `text`, `color` or any other option shows on the next frame, and a
tween can drive the numeric ones.

### Draw text in `paint`

A node that paints itself calls `fillText` on its canvas. Declare the string
with {@link definePaintProps} so that changing it repaints the node.

```ts
import { Node2D, definePaintProps } from '@src/stargazer'
import type { Canvas } from '@src/stargazer'

class ScoreLabel extends Node2D {
  declare score: number

  constructor() {
    super()
    definePaintProps(this, { score: 0 })
  }

  override paint(canvas: Canvas): void {
    canvas.fillText(`Score: ${this.score}`, 0, 0, {
      font: '700 32px Inter, sans-serif',
      align: 'center',
      baseline: 'middle',
      color: '#fff',
    })
  }
}
```

`(x, y)` is the anchor in the node's local space. `align` places the text
horizontally around it and `baseline` vertically. One call draws one line and
never wraps.

### Fit text to a width

[`wrapText`](/module/render/wraptext) breaks a string into lines that fit a
width, so you can draw a paragraph line by line.

```ts
import { wrapText } from '@src/stargazer'

const font = '400 18px Inter, sans-serif'
const lines = wrapText(rules, font, 300, 4)
lines.forEach((line, i) => {
  canvas.fillText(line, 0, 24 + i * 22, { font, color: '#222' })
})
```

The result has at most 4 lines. If the text needs more, the last line ends with
an ellipsis. Without the fourth argument, `wrapText` allows 3 lines.

### Use a webfont

**Load every font face before the first frame that uses it.** The engine
caches text by its font string, so text drawn before the face arrives keeps the
fallback face. Wait for the faces before you build the scene:

```ts
await Promise.all([
  document.fonts.load('400 18px Inter'),
  document.fonts.load('700 18px Inter'),
])
```

A family the page has no `@font-face` for falls through to the next entry in
the font stack, with no warning. If a face can still arrive after the first
frame, see "Fonts that load late" under Advanced usage.

## Advanced usage

This section lists every option, then covers measuring and laying out text,
mixed weights and inline icons, fonts that load late, and how the renderer
keeps text sharp and cheap.

### `TextNode` options

The constructor takes a {@link TextNodeOptions} object. Every option is also a
public field with the same name.

| Option       | Default        | Meaning                                                 |
| ------------ | -------------- | ------------------------------------------------------- |
| `text`       | (required)     | The string. Each `\n` starts a new line.                |
| `x`, `y`     | `0`            | Anchor in local space.                                  |
| `fontFamily` | `'sans-serif'` | Family or font stack.                                   |
| `fontWeight` | `'normal'`     | CSS weight, such as `400`, `'700'` or `'bold'`.         |
| `fontSize`   | `16`           | Size in `sizeSpace` units.                              |
| `sizeSpace`  | `'screen'`     | `'screen'` (CSS pixels) or `'world'` (world units).     |
| `color`      | `'#000'`       | CSS color.                                              |
| `align`      | `'left'`       | Horizontal anchor.                                      |
| `baseline`   | `'alphabetic'` | Vertical anchor.                                        |
| `lineHeight` | `1.2`          | Line spacing, a multiple of the font's own line height. |
| `id`         | none           | Node id.                                                |

`sizeSpace` decides how `fontSize` is read. It works like the stroke width of a
{@link ShapeNode}:

- With `'screen'`, `fontSize` is in CSS pixels. The text keeps its size on
  screen when the camera zooms.
- With `'world'`, `fontSize` is in world units. The text grows and shrinks with
  the camera.

A `TextNode` doesn't wrap. A string with `\n` draws as a block of lines, and
`baseline` then anchors the whole block: `'top'` puts the block's top at `y`,
`'middle'` centers it, and `'bottom'` puts its bottom at `y`. `'alphabetic'` and
`'hanging'` act like `'top'` for a block.

`TextNode` implements {@link Measurable}, so it can sit in a layout container
such as {@link Box}, {@link Row} or {@link Column}. The container measures the
text at `fontSize` and places it in the box it assigns. `align` and `baseline`
then pick the point inside that box. See [Layout](/guides/layout).

### `fillText` style

The fourth argument of `fillText` is a {@link GfxTextStyle}. Every field is
optional.

| Field      | Default             | Meaning                           |
| ---------- | ------------------- | --------------------------------- |
| `font`     | `'10px sans-serif'` | CSS font shorthand.               |
| `align`    | `'left'`            | Horizontal anchor for `x`.        |
| `baseline` | `'alphabetic'`      | Vertical anchor for `y`.          |
| `color`    | `'#000'`            | CSS color, baked into the bitmap. |

The color is part of the rasterized bitmap, not a tint. A multi-color emoji
keeps its own colors, and any CSS color string works. The node's alpha and
[`setAlpha`](/module/scene/canvas#setalpha) apply on top of it.

`fillText` takes no `maxWidth`. Text can't have an outline or stroke, letter
spacing or tab stops.

### Measure text

The measuring functions take a CSS font string and return sizes in the same
local units `fillText` draws in. They cache their results, so calling them from
every `paint` is cheap.

| Function                                        | Returns                                                           |
| ----------------------------------------------- | ----------------------------------------------------------------- |
| `textWidth(text, font)`                         | Width of the line's bitmap box.                                   |
| `textAdvance(text, font)`                       | How far the pen moves after the line.                             |
| `textMetrics(text, font)`                       | Advance, ink ascent and descent, cap height and line height.      |
| `fontMetrics(font)`                             | Ascent, descent, cap height and line height of the font.          |
| `measureText(text, style)`                      | The full {@link LabelMetrics} for a `GfxTextStyle`.               |
| `ellipsize(text, font, maxWidth)`               | The line, cut to fit and ended with an ellipsis.                  |
| `wrapText(text, font, maxWidth, maxLines?)`     | Lines that fit `maxWidth`. The last is ellipsized if text is cut. |
| `wrapTextInfo(text, font, maxWidth, maxLines?)` | The same lines, plus whether text was cut.                        |
| `fitFontSize(text, sizes, makeFont, maxWidth)`  | The largest size whose line fits. Pass the sizes largest first.   |
| `fitTextBlock(text, sizes, makeFont, box)`      | The largest size whose wrapped lines fit a box, with baselines.   |

{@link textWidth} and {@link textAdvance} are different numbers.
`textWidth` is the bitmap box, which includes transparent padding around the
glyphs and any ink that overhangs the advance. Fit text into a box with it.
`textAdvance` is the pen step. Add it to `x` to draw a second run right after
the first. Stepping by `textWidth` leaves a visible gap.

`wrapText` breaks lines at whitespace only. It doesn't split a word that is
wider than `maxWidth`, so that line overflows. Pass the line through
{@link ellipsize} when the box edge must hold. `fitFontSize` returns the last
size in the list when none fits.

### Vertical metrics

There are two kinds of vertical metrics. {@link textMetrics} reports the ink of
one string. Its `ascent` and `descent` bound that exact text, so `"acme"` and
`"Ajax"` differ. {@link fontMetrics} reports the font. Use its `lineHeight` to
space lines, and its `capHeight` to center text optically.

`baseline: 'middle'` centers the em box. The em box includes room for
descenders the text may not have, so text centered that way sits low. Two sizes
centered that way on one row also end up on different baselines. To center a
row, put the baseline at the center plus half the cap height, and draw with
`baseline: 'alphabetic'`.

This example draws a large number and a small unit on one baseline, centered
on `cy`.

```ts
import { textMetrics } from '@src/stargazer'

const bigFont = '700 40px Inter, sans-serif'
const smallFont = '400 20px Inter, sans-serif'
const big = textMetrics('42', bigFont)
const baseline = cy + big.capHeight / 2
canvas.fillText('42', x, baseline, { font: bigFont, baseline: 'alphabetic' })
canvas.fillText('k', x + big.advance, baseline, {
  font: smallFont,
  baseline: 'alphabetic',
})
```

A block of `n` lines is `n - 1` line gaps plus one line box. Counting
`n * lineHeight` adds an empty line at the bottom. {@link fitTextBlock} does
this for you. It returns a {@link TextBlock} with the chosen `size`,
`lineHeight`, `firstBaselineY` and `height`, and `truncated` when even the
smallest size had to drop words.

This example centers a block of text vertically in a box.

```ts
import { fitTextBlock } from '@src/stargazer'

const mkFont = (size: number) => `400 ${size}px Inter, sans-serif`
const block = fitTextBlock(text, [20, 18, 16, 14], mkFont, box)
const top = box.y + (box.height - block.height) / 2
block.lines.forEach((line, i) => {
  canvas.fillText(
    line,
    box.x,
    top + block.firstBaselineY + i * block.lineHeight,
    {
      font: mkFont(block.size),
      baseline: 'alphabetic',
    },
  )
})
```

The optional fifth argument, `lineHeightRatio`, scales the font's own line
height. The default `1` is the font's natural spacing.

Text that still overflows can be cropped with
[`setClip`](/module/scene/canvas#setclip), which applies to text like any other
draw. Measuring first is cheaper and keeps the text readable.

### Mixed weights in one paragraph

`fillText` takes one font per call, so a line such as "add **2k** to the
budget" is drawn as several runs. {@link wrapRichText} takes a list of
{@link TextSpan} objects, each `{ text, bold? }`. It breaks lines at whitespace
and returns {@link RichLine} objects whose runs carry their `x` offsets. A
`makeFont(bold)` callback supplies the font for each weight.

```ts
import { wrapRichText, type TextSpan } from '@src/stargazer'

const spans: TextSpan[] = [
  { text: 'add ' },
  { text: '2k', bold: true },
  { text: ' to the budget' },
]
const font = (bold: boolean) => `${bold ? 700 : 400} 18px Inter, sans-serif`
let y = box.y
for (const line of wrapRichText(spans, font, box.width)) {
  for (const run of line.runs) {
    if (run.kind === 'text') {
      canvas.fillText(run.text, box.x + run.x, y, { font: font(run.bold) })
    }
  }
  y += 22
}
```

Neighboring pieces with the same weight join into one run, so a line costs one
`fillText` and one cached label per weight change, not one per word. Like
`wrapText`, `wrapRichText` allows 3 lines unless you pass `maxLines`.

{@link fitRichTextBlock} is the rich version of `fitTextBlock`. Its `makeFont`
takes `(size, bold)`, and it returns a {@link RichBlock} with the same fields as
a `TextBlock`. A span sets a weight, not a size, so the engine doesn't lay out
a line that mixes sizes. Lay that out yourself with `textMetrics`, as in the
vertical metrics example.

### Icons in a paragraph

A span can also be an {@link InlineBox}: a rectangle that the engine measures,
wraps and positions, but never draws. It has a name, a height in em
(`heightEm`) and a width-to-height ratio (`aspect`). Your code paints the box
from its name.

```ts
const spans: TextSpan[] = [
  { text: 'costs 3 ' },
  { box: 'coin', heightEm: 1.2, aspect: 1, alt: 'coins' },
]
let y = box.y
for (const line of wrapRichText(spans, font, box.width)) {
  for (const run of line.runs) {
    if (run.kind === 'box') {
      canvas.drawImage(
        icons[run.box],
        box.x + run.x,
        y + run.y,
        run.width,
        run.height,
      )
    } else {
      canvas.fillText(run.text, box.x + run.x, y, { font: font(run.bold) })
    }
  }
  y += 22
}
```

Sizes are in em, so a box follows whatever size `fitRichTextBlock` picks. A box
run's `y` is measured from the text's baseline and is negative. The box is
centered on the font's cap height, level with the digits next to it.

A box behaves differently from text in these ways:

- A box isn't whitespace, so it never breaks a line. It stays attached to the
  word next to it. Add a space span, or set `leadEm` or `trailEm` on the box,
  where you want a gap.
- A box splits runs. `text box text` is three runs and three labels, where the
  same words without the box would be one.
- A box taller than the text raises the line height of the whole block. Fewer
  lines then fit, so `fitRichTextBlock` can fall back to a smaller size.

{@link richText} joins spans back into one string and uses each box's `alt`
text. Use it for a log line, a tooltip or a screen reader label.

### Fonts that load late

The renderer caches each label by its font string, not by whether that face had
loaded. A label drawn before its webfont arrives uses the fallback face and
keeps it until the label leaves the cache. The measurement caches behave the
same way, and the result is worse: `fontMetrics` and the wrap functions keep
sizes and line breaks taken from the fallback face, so text ends up in the wrong
place.

If a face can still arrive after the first frame, clear all three caches when
it does:

```ts
import { clearFontMetricsCache, clearTextLayoutCaches } from '@src/stargazer'

document.fonts.addEventListener('loadingdone', () => {
  clearFontMetricsCache()
  clearTextLayoutCaches()
  engine.invalidateText()
})
```

[`invalidateText`](/module/engine/engine#invalidatetext) drops the rasterized
labels on every stage, and the next frame rasterizes them again with the real
face. It can't fix a font string or a measurement that a node took once in its
constructor. Rebuild those nodes.

### Sharpness

The picture records the `fillText` call. The renderer rasterizes the label when
it replays the picture, at the size the text has on screen. It takes the scale
of the transform the text is drawn under, ignoring rotation, and rasterizes the
font at its size in device pixels. Zooming a node therefore doesn't repaint its
picture for the text's sake.

Three details keep the result crisp:

- The pen starts on a whole texel, so stems and baselines don't fall across a
  texel boundary in the bitmap.
- The quad has exactly the texture's size, so at rest one texel covers one
  device pixel.
- A label that isn't rotated or skewed snaps to a whole device pixel.

Text is blended in gamma space, like Canvas 2D and the rest of the 2D renderer.
Light text on a dark background looks a little heavier than dark text on a
light one.

### The label cache

Shaping and uploading a label are the costs to keep out of the frame loop. The
renderer caches each label by its text, its font without the size, `align`,
`baseline`, `color`, and its size in device pixels, rounded to 1/16 pixel. The
cache has these effects:

- Rotation and movement reuse the texture. Only the quad changes per frame.
- Screen-space text keeps its device size when the camera zooms, so a zoom
  rasterizes nothing.
- Text whose device size keeps changing (world-space text during a zoom, a
  scale tween, a font size tween) doesn't rasterize every frame. It keeps
  drawing its last raster while that raster is at most 2 times larger or 1.6
  times smaller than needed. Once the size has held still for 8 frames, or left
  that range, the label rasterizes at the exact size.
- Fading is free and changing color is not. Alpha is applied when the quad is
  drawn. Color is baked into the bitmap, so animating it rasterizes a new label
  every frame the value changes.

The cache holds 768 entries, text and small images together. All labels up to
512 pixels on each side share one 2048 by 2048 texture page, so they draw in one
batch. A larger label gets its own texture, which breaks the batch.

The cache evicts only when it is full. Past 768 entries it drops the oldest
label. A label drawn in the last 2 frames moves to the back once instead. A full
cache is normal and costs no extra memory, because the shared page has a fixed
size.

When the page has no room for a new label, the renderer frees up to 32 labels that weren't drawn this frame. If that
isn't enough, it clears the page at the start of the next frame, which
rasterizes every label on screen again in one frame.

The renderer rasterizes at most 24 new labels per frame. Past that, a label
draws its last raster when one is in range. A label with no raster yet still
rasterizes at once, so the first frame of a scene pays for all of its text.

A very long string or an extreme zoom would need a texture larger than 2048
pixels. The renderer lowers the raster scale to fit, which softens the label
instead of failing.

### Read the label cache

The rendering panel of the debug HUD shows how full the label cache is and how
often the page was cleared. The texture inspector shows each cached label, the
page and its free space, and counts evictions, page clears and clamped rasters.
A page clear is the expensive event. See [Debugging](/guides/debugging).

## See also

- {@link TextNode}: a scene node that draws a string
- {@link Canvas}: `fillText` and the other draw calls
- {@link GfxTextStyle}: the style of one `fillText` call
- {@link wrapText}: break a string into lines
- {@link fitTextBlock}: fit a paragraph into a box
- {@link wrapRichText}: lay out mixed weights and inline boxes
- [Drawing](/guides/drawing): painting with a canvas
- [Layout](/guides/layout): placing text in containers
- [Debugging](/guides/debugging): the rendering panel and texture inspector

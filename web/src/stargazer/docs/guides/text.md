# Text

Text draws through `Gfx2D.fillText`, either called directly inside a node's `draw` or through the `TextNode` wrapper. The renderer shapes the string with the platform Canvas 2D engine (kerning, ligatures, complex scripts, emoji), rasterizes the shaped line to a cached texture, and draws it as a quad, so a label stays sharp and cheap while it rotates or the camera zooms.

## Two ways in

- `Gfx2D.fillText(text, x, y, style?)` inside a node's `draw`, for a label the node paints itself (a live score, a coordinate readout).
- `TextNode`, a scene node you add to the tree. It holds the string and style and calls `fillText` for you each frame.

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

label.text = 'Go' // every option is a public field, the next frame picks it up
```

| Option       | Default      | Meaning                                    |
| ------------ | ------------ | ------------------------------------------ |
| `text`       | (required)   | the string to draw, split on `\n`          |
| `x`, `y`     | `0`          | anchor in local space                      |
| `fontFamily` | `sans-serif` | family or stack                            |
| `fontWeight` | `normal`     | CSS weight (`400`, `'700'`, `'bold'`)      |
| `fontSize`   | `16`         | size in `sizeSpace` units                  |
| `sizeSpace`  | `screen`     | `screen` (CSS px) or `world` (world units) |
| `color`      | `#000`       | CSS color                                  |
| `align`      | `left`       | horizontal anchor                          |
| `baseline`   | `alphabetic` | vertical anchor                            |
| `lineHeight` | `1`          | multiplier on the font's own line height   |

`sizeSpace` decides how `fontSize` reads, the same split `ShapeNode` uses for stroke width:

- `'screen'` (default): `fontSize` is CSS pixels, so the label holds a constant on-screen size as the camera zooms.
- `'world'`: `fontSize` is world units, so the label scales with the field.

## Sharpness

The label is rasterized at the resolution it occupies on screen. `fillText` reads the current transform, takes `deviceScale = max(hypot(a, b), hypot(c, d))` (the transform's scale, independent of any rotation), and rasterizes at that scale.

Three things keep the result crisp, and all three have to hold at once:

- **The pen lands on a whole texel.** Canvas 2D reports the ink box as floats, so drawing at the raw offset would put every baseline and stem across a texel boundary, where the rasterizer greys it out. That blur bakes into the bitmap and no amount of snapping afterwards recovers it.
- **The quad covers the texture exactly.** The destination size comes from the texture rather than from the measured box, so when the device scale matches the raster scale the blit is 1:1.
- **The position snaps.** An axis-aligned label rounds its origin to a whole device pixel, which is only worth anything because of the two above.

Raster scales are bucketed at `2**(1/3)`, always rounding up, so a label is minified a little rather than magnified. The buckets land exactly on device pixel ratios of 1, 2 and 4, because three steps make an octave.

## Caching and animation cost

Shaping the string in Canvas 2D and uploading the texture are the costs to keep off the per-frame path. Each label is cached, keyed by its text, font, alignment, baseline, color, and a scale bucket, under an LRU bound. What that buys:

- Rotation reuses the texture. `deviceScale` ignores rotation, so a spinning label rasterizes once and only its quad transform changes per frame.
- Screen-space labels never re-rasterize on zoom. Their device size is `fontSize × dpr` whatever the camera scale, so a zoom tween leaves the cache untouched. This is the common HUD case.
- World-space labels re-rasterize in steps. The scale rounds up to the next bucket, so panning through a zoom costs a few uploads rather than one per frame, and the label only ever samples down, which stays crisp, instead of upscaling, which blurs.
- Alpha is free, color is not. Alpha rides the quad tint. Color is baked into the bitmap, so animating it re-rasterizes on every frame the value changes. Prefer an alpha fade or a fixed color.

## Fitting text to a box

Drawing is still one line per call, but `wrapText` and its companions do the
measuring so a string can be fitted to a known width before it is drawn. They
build on `measureText`, and every level memoizes (the shaping, the wrapped
lines, and the rich-text runs), so a node redrawing static text every frame pays
nothing after the first.

```ts
import { wrapText, ellipsize, fitFontSize, textWidth } from '@src/stargazer'

const font = '400 18px Inter, sans-serif'
const lines = wrapText(card.rules, font, box.width - 16, 3)
lines.forEach((line, i) =>
  gfx.fillText(line, box.x + 8, box.y + 24 + i * 22, { font, color: '#222' }),
)
```

| Function                                       | Use                                                                    |
| ---------------------------------------------- | ---------------------------------------------------------------------- |
| `wrapText(text, font, maxWidth, maxLines?)`    | Break into lines, ellipsizing the last if the text overruns `maxLines` |
| `ellipsize(text, font, maxWidth)`              | Trim one line to fit, leaving a trailing ellipsis                      |
| `fitFontSize(text, sizes, makeFont, maxWidth)` | Largest size (pass them largest first) whose text fits                 |
| `textWidth(text, font)`                        | Bitmap box of one line, in the units `fillText` draws in               |
| `textAdvance(text, font)`                      | Pen advance of one run, for placing the next run beside it             |
| `textMetrics(text, font)`                      | Advance, ink ascent and descent, cap height and line height, together  |
| `fontMetrics(font)`                            | Ascent, descent, cap height and line height for the font alone         |
| `fitTextBlock(text, sizes, makeFont, box)`     | Largest size whose wrapped lines fit `box`, with baselines             |
| `richText(spans)`                              | Join a rich paragraph back to a string, boxes as their `alt`           |

`textWidth` and `textAdvance` are not the same number. `textWidth` is the
label's bitmap box, so it carries the transparent padding baked around the
glyphs and any ink that overhangs the advance. It is what to fit against a box.
`textAdvance` is the pen step, and it is what to add to `x` when drawing one run
after another on a line. Stepping by `textWidth` opens a visible gap between
them.

`wrapText` breaks on whitespace only. A single word wider than `maxWidth` is
left overlong rather than split mid-word, so wrap the result in `ellipsize` when
the box is a hard boundary.

## Vertical metrics

Anything stacking or centring text needs real metrics, and there are two kinds.
`textMetrics(text, font)` reports the ink of one string: its `ascent` and
`descent` bound that exact text, so `"acme"` and `"Ajax"` differ. `fontMetrics(font)`
reports the typeface: `lineHeight` for spacing lines, and `capHeight` for optical
centring. Space a block on the font, size a box around a string on the ink.

Two habits worth breaking. `baseline: 'middle'` centres the em box, which
reserves descender room the text may not use, so a line centred that way sits
low and two different sizes on one row land on two different baselines. Centre
on `capHeight` and draw with `baseline: 'alphabetic'` instead. And a block of
`n` lines is `(n - 1)` gaps plus one line box, not `n * lineHeight`, which adds
a phantom line of trailing leading.

```ts
// One row, two sizes, one baseline.
const big = textMetrics(String(cost), bigFont)
const baseline = cy + big.capHeight / 2
gfx.fillText(String(cost), x, baseline, {
  font: bigFont,
  baseline: 'alphabetic',
})
gfx.fillText('k', x + big.advance, baseline, {
  font: smallFont,
  baseline: 'alphabetic',
})
```

`fitTextBlock` and `fitRichTextBlock` do this for you. Both report
`firstBaselineY` and `height`, so a centred block is:

```ts
const block = fitTextBlock(text, sizes, mkFont, box)
const top = box.y + (box.height - block.height) / 2
block.lines.forEach((line, i) =>
  gfx.fillText(line, box.x, top + block.firstBaselineY + i * block.lineHeight, {
    font: mkFont(block.size),
    baseline: 'alphabetic',
  }),
)
```

Their `lineHeightRatio` scales the font's own line height, so `1` is the
typeface's natural spacing rather than a guess at it.

If text overflows anyway, `setClip` will crop it, since `textQuad` honours the
analytic clip like every other 2D program. A clip only hides the overflow
though, so measuring up front is still the cheap path and the readable one.

## Mixed weight in one paragraph

`fillText` takes one font per call, so a line like "add **2k** to budget" is
drawn as several runs. `wrapRichText` / `fitRichTextBlock` take `TextSpan[]`
(each `{ text, bold? }`), break on whitespace as above, and return lines of
positioned `RichRun`s. Neighbouring pieces of the same weight are coalesced into
one run (one `fillText`, one cached label) so a mixed line costs one label per
weight span, not one per word. A `makeFont(bold)` callback supplies the font for
each weight.

```ts
import { wrapRichText, type TextSpan } from '@src/stargazer'

const spans: TextSpan[] = [
  { text: 'add ' },
  { text: '2k', bold: true },
  { text: ' to everyone’s budget' },
]
const font = (bold: boolean) => `${bold ? 700 : 400} 18px Inter, sans-serif`
let y = box.y
for (const line of wrapRichText(spans, font, box.width)) {
  for (const run of line.runs) {
    gfx.fillText(run.text, box.x + run.x, y, { font: font(run.bold) })
  }
  y += 22
}
```

`fitRichTextBlock(spans, sizes, makeFont, box)` is the rich counterpart of
`fitTextBlock`: `makeFont` takes `(size, bold)`, and the block reports the chosen
`size`, `lineHeight`, `firstBaselineY`, `height`, and whether it `truncated`.

A `TextSpan` carries a weight, not a size, so the engine will not lay out a
mixed-size line. Do that by hand with `textMetrics`, as above.

## Icons in a paragraph

A span can also be an `InlineBox`: a rectangle the engine measures, wraps and
positions, and never draws. It holds no image, only a size and a name, so a
paragraph can flow around an icon without the engine knowing what the icon is.
The caller paints it from the name.

```ts
const spans: TextSpan[] = [
  { text: 'per ' },
  { box: 'badge:design', heightEm: 1.2, aspect: 1, alt: 'Design' },
]
for (const line of wrapRichText(spans, font, box.width)) {
  for (const run of line.runs) {
    if (run.kind === 'box') {
      gfx.drawImage(icons[run.box], x + run.x, y + run.y, run.width, run.height)
    } else {
      gfx.fillText(run.text, x + run.x, y, { font: font(run.bold) })
    }
  }
  y += lineHeight
}
```

Sizes are in em, so a box tracks whichever size `fitRichTextBlock` settles on.
`run.y` is measured from the same baseline the text sits on and is negative: a
box is centred on the font's cap height, level with the digits beside it.

Three things follow from a box not being text.

A box is not whitespace either, so it never breaks a word. It welds to whatever
sits against it, which is what keeps a badge with the number it qualifies. Emit
a space span, or give the box `leadEm` / `trailEm`, wherever a gap is wanted.

A box breaks run coalescing, so `text box text` is three runs and three labels
where the same words without the box would be one. An iconised paragraph costs
more labels per line, not fewer.

A box taller than the text raises the line height, which cuts how many lines
fit, which can drop the block a rung down the size ladder. Around an em is
free. Much above that and the icon buys itself smaller text.

`richText(spans)` joins a paragraph back into a string, taking each box's
`alt`. Iconography otherwise leaves nothing to log, put in a tooltip, or hand
to a screen reader.

## Warming a text-heavy scene

A label is shaped, rasterized and uploaded inside the `fillText` that first
needs it, on the render thread. The per-frame regen budget does not soften a
first paint, because it falls back to a neighbouring scale bucket and on the
first frame no bucket is populated. `gfx.warmText(text, style)` does that work
early, under the transform the text will later be drawn with.

```ts
// On a loading screen, before the board is built.
for (const card of deck) gfx.warmText(card.name, { font: nameFont })
```

The debug rendering panel's texture inspector reports the label cache and the
page it packs into: live labels against the cap, regens this frame, page rows
used, open shelves and free spans, and cumulative evictions, page wipes and
size clamps. A page wipe is the expensive one, since it drops every packed label
and re-rasterizes the scene in a single frame.

## Webfonts

Pass a resolved font stack. `fontFamily` and `GfxTextStyle.font` are plain CSS,
so a family the document has no `@font-face` for silently falls through to the
next entry in the stack.

The label cache is keyed by the font _string_, not by whether that font had
loaded. So a label drawn before its webfont arrives rasterizes with the fallback
face and keeps serving that bitmap until the entry is evicted. The measurement
caches behave the same way, and are the worse half: `fontMetrics` and the
`textLayout` memo hold ascent, descent and wrap points taken against the
fallback, so a late font leaves text _mislaid_, not merely restyled.

The engine cannot fix this on its own, because it has no view of the document's
font loading. The contract is on the host application:

1. Load every face and wait for it before the first frame. This is the real
   answer, and everything below is damage control.
2. If a face can still turn up late, listen for it and throw the stale work
   away:

```ts
document.fonts.addEventListener('loadingdone', () => {
  clearFontMetricsCache()
  clearTextLayoutCaches()
  engine.invalidateText() // drops label rasters, invalidates retained layers
})
```

`invalidateText` cannot reach a font string or a measurement captured once in a
node's constructor. Those need the node rebuilt. And `warmText` is only safe
after the fonts have settled, because warming early just bakes the fallback in
sooner.

In this repo the host side lives in `core/fonts`: `preloadFonts()` gates the
mount, and `invalidateTextOnFontLoad(engine)` wires up the three clears above.
Stacks come from `core/theme`: `fontFor(fonts, 'text' | 'heading', weight, px)`
for the two themeable roles, or `fontWith(FAMILIES.azeretMono, weight, px)` when
one specific face is wanted.

## Limits

- One line per `fillText` call. No outline or stroke, no `maxWidth` argument.
- No letter-spacing, tab stops or column alignment.
- No mipmaps, so a world-space label zoomed far out softens under bilinear sampling.
- Text is blended in gamma space, matching Canvas 2D and the rest of the 2D renderer, so light-on-dark reads a little heavier than dark-on-light.
- A very long string or an extreme zoom clamps the raster scale to stay within the GPU's max texture size, trading a little sharpness for not throwing.

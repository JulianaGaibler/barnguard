---
title: Lottie
group: Features
order: 12
---

# Lottie

Lottie files describe vector animations as JSON. {@link LottieNode} plays one in
the scene. It turns each layer of the animation into a child node, so the
animation draws through the same renderer as the rest of the frame and batches
with it.

To play a file, parse it with {@link parseLottie} or fetch it with
{@link loadLottie}, then give the result to a `LottieNode`. A `.lottie` archive
opens with {@link loadDotLottie}. The `lottie` dev demo (`?demo=lottie`) shows
the features on this page.

## Basic usage

This example loads an animation and adds it to the scene as a 96 by 96 box.

```ts
import { LottieNode, loadLottie } from '@src/stargazer'

const spinner = new LottieNode({
  animation: await loadLottie('/spinner.json'),
  width: 96,
  height: 96,
})
spinner.transform.x = 200
scene.root.add(spinner)
```

The node plays and loops from the start. Its origin is the top-left corner of
the box, and the animation is scaled to fit inside the box and centered. The
engine advances it every frame. Without `width` and `height`, the box has the
animation's own size.

### Control playback

The node has methods for the common controls. Frames count from 0 at the
animation's first frame.

```ts
spinner.pause()
spinner.seek(30)
spinner.play()
spinner.setSegment(0, 59) // play only frames 0 to 59
spinner.setMarker('idle') // play only the range of a named marker
spinner.setMarker(null) // play the whole animation again
spinner.stop() // pause and return to the first frame
```

`currentFrame`, `totalFrames`, `durationMs` and `markers` describe the
playback. For events and the remaining controls, use the node's `player`, a
{@link LottiePlayer}:

```ts
spinner.player.events.on('loop', ({ count }) => console.log('loops', count))
spinner.player.events.on('complete', () => console.log('done'))
spinner.player.setSpeed(2)
```

The player emits `frame`, `render`, `loop`, `complete`, `play`, `pause` and
`stop`.

### Load a `.lottie` file

A `.lottie` file is a zip archive with a manifest, one or more animations,
themes, and the images and fonts they use.

```ts
import { LottieNode, loadDotLottie } from '@src/stargazer'

const file = await loadDotLottie('/mascot.lottie')
const mascot = new LottieNode({
  animation: file.getAnimation(),
  assetResolver: (image) => file.getImage(image.path) ?? '',
})
mascot.setTheme(file.getTheme('dark'))
scene.root.add(mascot)
```

`getAnimation()` without an id returns the manifest's first animation. The
`assetResolver` reads image layers from the archive. `setTheme` applies a theme
from the file, and `setTheme(null)` returns to the file's own colors.

### Check what was not drawn

The engine doesn't draw every Lottie feature. It never throws for one it skips.
It lists the feature in `diagnostics` instead, each entry with a stable `code`,
a `message` and, when there is one, the `layer` name.

```ts
for (const d of spinner.diagnostics) console.warn(d.code, d.layer, d.message)
```

Check the list when an animation looks different from the design tool. The
codes are listed under Advanced usage.

## Advanced usage

This section lists the node's options and explains how the node draws. It
then covers which features are drawn, text and image layers, the diagnostic
codes, themes and slots, archives, and using the player on its own.

### `LottieNode` options

The constructor takes a {@link LottieNodeOptions} object.

| Option                  | Default             | Meaning                                                     |
| ----------------------- | ------------------- | ----------------------------------------------------------- |
| `animation`             | (required)          | The parsed {@link LottieAnimation}.                         |
| `width`, `height`       | animation size      | The box the animation is fitted into.                       |
| `fit`                   | `'contain'`         | How the animation scales to the box.                        |
| `alignX`, `alignY`      | `'center'`          | Where the animation sits in the box.                        |
| `autoplay`              | `true`              | Start playing at once.                                      |
| `looping`               | `true`              | Start again at the end.                                     |
| `loopCount`             | `0`                 | Total playthroughs when looping. `0` loops forever.         |
| `speed`                 | `1`                 | Playback rate, above 0.                                     |
| `mode`                  | `'forward'`         | `'forward'`, `'reverse'`, `'bounce'` or `'reverse-bounce'`. |
| `segment`               | whole animation     | Play only frames `[start, end]`.                            |
| `useFrameInterpolation` | `true`              | `false` rounds to whole frames.                             |
| `opacityMode`           | `'exact'`           | How layer opacity applies. See below.                       |
| `offscreen`             | `'advance'`         | What happens while the node isn't drawn.                    |
| `assetResolver`         | see image layers    | Where image layers get their pictures.                      |
| `baseUrl`               | none                | Prefix for relative image paths.                            |
| `imageDecoder`          | `createImageBitmap` | Turns a resolved image into something drawable.             |
| `id`                    | none                | Node id.                                                    |

`width`, `height` and `fit` are also writable properties. With
`offscreen: 'freeze'`, the animation stops advancing while the node is culled or
hidden, and resumes from the same frame. With `'advance'`, time keeps running.

In bounce modes, playback turns around at the end without counting a loop. One
`loop` event fires per full cycle there and back.

### Fit and alignment

`fit` is one of `'contain'`, `'cover'`, `'fill'`, `'fit-width'`,
`'fit-height'` or `'none'`. An alignment is `'start'`, `'center'`, `'end'` or a
number from 0 to 1.

`LottieNode` implements {@link Measurable}, so it can sit in a layout container
such as {@link Row} or {@link Column}. The container sets its box.

The node computes its placement with {@link computeLayout}. You can call it to
place other content the same way:

```ts
import { computeLayout } from '@src/stargazer'

const { scaleX, scaleY, x, y } = computeLayout(
  anim.width,
  anim.height,
  320,
  200,
  'contain',
  'center',
  'center',
)
```

The result scales content of the animation's size to fit a 320 by 200 box, and
`x` and `y` are its offset inside the box.

### How the node draws

Each layer of the animation becomes a node under the `LottieNode`, and a
precomposition holds its layers as child nodes. A layer's matrix is its node's
transform. A layer that only moves, scales or rotates repaints nothing, and a
layer whose shapes never change paints once.

The node evaluates the animation only when the playback frame or its box
changed, and only while it is drawn. A paused or culled animation costs only
its draws. A layer repaints only when something it paints is animated: a shape,
a color, a stroke, its opacity or a repeater. Its paths are built once and
reused.

Masks, track mattes, blend modes and exact layer opacity use offscreen
surfaces. They are built from the node properties
[`compositeGroup`](/module/scene/node2d#compositegroup),
[`compositeBlend`](/module/scene/node2d#compositeblend) and
[`matte`](/module/scene/node2d#matte). The animation is clipped to its own
bounds, and each precomposition to its bounds.

`opacityMode` decides how layer opacity applies:

- `'exact'` (the default) draws a partly transparent layer with more than one
  fill or stroke into a surface, then fades the surface. Overlapping shapes in
  the layer don't show through each other.
- `'fold'` multiplies the opacity into every shape. It needs no surface, and
  differs from `'exact'` only where a layer's shapes overlap.

`transform.alpha` on the node fades the whole animation, like alpha on any
node.

### What is drawn

The engine draws these features:

- Shape, solid, null, precomposition, text and image layers, with parenting,
  layer timing and time remapping.
- Paths, rectangles with rounded corners, ellipses, polygons and stars.
- Solid fills, linear and radial gradient fills with highlight, and fill rules.
- Solid and gradient strokes with dashes, caps and joins.
- Layer and group transforms, including skew.
- The trim paths, repeater, round corners and pucker and bloat modifiers, and
  merge paths in the merge, add and exclude intersections modes. A modifier
  also shapes the groups listed above it, so a trim after a group trims that
  group's strokes.
- Masks in the add, subtract, intersect, lighten, darken and difference modes,
  with inversion and mask opacity. Lighten draws like add, darken like
  intersect, and difference keeps what one mask covers and the other doesn't.
  These three match the design tool only where mask edges are hard.
- Track mattes: alpha, inverted alpha, luma and inverted luma.
- The multiply, screen and add blend modes.

A layer with a single add mask at full opacity is clipped to the mask's shape
directly. Every other mask uses a surface. A stroke with butt or square caps,
or a miter or bevel join, goes through the slower outline stroker. So do
gradient strokes.

The engine never evaluates expressions. A property with an expression plays the
keyframes stored in the file. Star roundness isn't applied. Text on a path and
the text document's stroke aren't drawn, and no diagnostic reports them.

### Text layers

A text layer draws each character from the glyph outlines the file embeds,
which is what a design tool exports when it converts fonts to outlines. It uses
the document's fill color, size, tracking, line height and justification. The
document that applies is the last one whose frame has passed.

When a line has a character with no outline, the whole line draws with the
platform font the file names, through the engine's text renderer. That font has
to be available to the page. The engine doesn't install the fonts in a
`.lottie` archive, so load them yourself before the animation draws. See
[Text](/guides/text).

### Image layers

An image layer draws its picture once it has loaded. For each image, the node
calls `assetResolver` with the file name (`path`), the folder (`dir`) and
whether the file embeds the image as a data URI (`embedded`). The resolver
returns a URL, a `Blob` or bytes, and `imageDecoder` turns that into something
drawable.

By default, the node uses an embedded data URI as it is. For any other image,
it fetches `baseUrl` plus the folder plus the file name and decodes it with
`createImageBitmap`. An image that fails to load leaves its layer empty and adds
an `image-missing` diagnostic.

### Diagnostic codes

The parser reports these codes:

| Code                                                      | Meaning                                               |
| --------------------------------------------------------- | ----------------------------------------------------- |
| `expression`                                              | An expression was ignored. The keyframed value plays. |
| `effect`                                                  | A layer effect was ignored.                           |
| `layer-style`                                             | A layer style was ignored.                            |
| `layer-3d`                                                | 3D layer properties other than rotation were ignored. |
| `collapse-transform`                                      | Collapse transformations isn't supported.             |
| `blend-mode`                                              | The hard mix blend mode draws as normal.              |
| `audio-layer`, `camera-layer`, `data-layer`, `layer-type` | The layer type is ignored.                            |
| `shape-item`                                              | A shape item type isn't supported.                    |

The renderer reports these codes, after it builds the layers:

| Code                         | Meaning                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `unsupported-mask-expansion` | Mask expansion isn't applied.                                      |
| `unsupported-blend`          | A blend mode other than multiply, screen and add draws as normal.  |
| `unsupported-auto-orient`    | Auto-orient isn't applied.                                         |
| `unsupported-text-animators` | Text animators aren't applied.                                     |
| `unsupported-offset-path`    | The offset path modifier isn't applied.                            |
| `unsupported-zig-zag`        | The zig-zag modifier isn't applied.                                |
| `unsupported-twist`          | The twist modifier isn't applied.                                  |
| `unsupported-merge-mode`     | Merge paths subtract or intersect of several shapes isn't applied. |

`unsupported-merge-mode` appears once the node has drawn a frame with that
merge. `image-missing` appears when an image fails to load. The
`diagnostics` of a {@link LottieAnimation} hold only the parser's codes. The
node's `diagnostics` hold all of them.

### Themes and slots

A slot is a property that the animation gives an id. A theme is a list of rules
that set slots. `setSlots` sets them by hand.

```ts
mascot.setTheme(file.getTheme('dark'))
mascot.setSlots({ 'body-main': { type: 'Color', value: [1, 0.2, 0] } })
mascot.resetSlots()
```

A value, a {@link LottieSlotValue}, has one of these types:

- `Color`: `[r, g, b, a?]` with each part from 0 to 1.
- `Scalar`: a number.
- `Vector` and `Position`: a list of numbers.
- `Gradient`: a list of `{ offset, color }` stops.

`Color`, `Scalar`, `Vector` and `Position` can give `keyframes` instead of a
`value`, each `{ frame, value, inTangent?, outTangent?, hold? }`. The alpha of a
color is ignored. Text and image slots aren't supported. `setSlots` returns how
many properties changed, and ignores unknown ids.

A theme rule with an `animations` list applies only to those animations, and
only when you pass the animation id as the second argument of `setTheme`.
`setTheme` resets every slot to the file's values before it applies the new
theme, so nothing from an earlier theme is left over.

A theme changes the {@link LottieAnimation} object the node holds. Two nodes
that should look different each need their own parse. `getAnimation` and
`loadLottie` return a fresh parse on every call.

{@link applyTheme}, {@link setSlotValue}, {@link resetSlots} and
{@link parseTheme} do the same work on an animation without a node.

### Archives and loading

{@link loadDotLottie} fetches and opens an archive, and {@link parseDotLottie}
opens bytes you already have. Both return a {@link DotLottie}. It has
`animationIds`, `themeIds`, the `manifest`, the raw `images` and `fonts`, and
`getAnimation(id?)`, `getTheme(id)` and `getImage(path)`. `getAnimation` and
`getTheme` throw for an unknown id. The reader accepts both archive layouts:
`animations/`, `themes/` and `images/` folders, or `a/`, `t/`, `i/` and `f/`.

Calls to `loadLottie` or `loadDotLottie` for the same URL share one fetch. A
fetch that fails is forgotten, so the next call tries again. Both take a
`fetch` option to replace the browser's `fetch`.

Deflated archive entries are decompressed with the browser's
`DecompressionStream('deflate-raw')`, and reading one throws where the browser
lacks it. ZIP64 and encrypted archives are rejected.

`parseLottie` accepts JSON text or an object. It throws only when the file has
no usable composition: no size, frame rate or frame range.

### The player on its own

{@link LottiePlayer} is the clock inside the node, and you can use it without a
node. It has no timers. Call `advance(dtMs)` once per frame and read the frame
it returns.

```ts
import { LottiePlayer, parseLottie } from '@src/stargazer'

const anim = parseLottie(json)
const player = new LottiePlayer(anim, { looping: true, autoplay: true })

// Once per frame:
const { frame, changed } = player.advance(dtMs)
if (changed) drawFrame(frame)
```

`frame` counts from 0 at the animation's first frame. `changed` is `false` when
nothing moved since the last call. A standalone player doesn't autoplay or loop
unless you ask, unlike the node. {@link LottiePlayerOptions} also takes
`marker`, the name of a marker to play, which wins over `segment`. A marker
with no length is a point: `setMarker` seeks to it. `setController` installs a
hook that runs at the start of every `advance`, for example a state machine
that changes segments.

## See also

- {@link LottieNode}: play an animation in the scene
- {@link LottiePlayer}: the playback clock
- {@link loadLottie}: fetch and parse Lottie JSON
- {@link loadDotLottie}: fetch and open a `.lottie` archive
- {@link DotLottie}: an opened archive
- {@link LottieTheme}: a parsed theme
- {@link computeLayout}: fit content into a box
- [Drawing](/guides/drawing): surfaces, mattes and blend modes
- [Layout](/guides/layout): containers that size the node
- [Text](/guides/text): fonts for text layers

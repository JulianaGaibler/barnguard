# Lottie

Lottie files describe vector animations as JSON. Stargazer parses them into a
compact model, plays them with a frame clock you control, and draws them through
`Gfx2D` so they batch with the rest of a frame.

## Parse a file

```ts
import { parseLottie } from '@src/stargazer'

const anim = parseLottie(await (await fetch('/spinner.json')).text())
anim.width // composition size in pixels
anim.frameRate
anim.totalFrames
anim.markers // [{ name, time, duration }]
anim.diagnostics // what was ignored or approximated
```

`parseLottie` accepts an object or a string. It throws only when the file has no
usable composition (no size, frame rate or frame range). Everything else the
engine does not support is listed in `diagnostics`, each with a stable `code`:

| Code                                                      | Meaning                                                 |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `expression`                                              | An expression was ignored. The keyframed value is used. |
| `effect`                                                  | A layer effect was ignored.                             |
| `layer-style`                                             | A layer style was ignored.                              |
| `layer-3d`                                                | 3D layer properties other than rotation were ignored.   |
| `collapse-transform`                                      | Collapse transformations is not supported.              |
| `blend-mode`                                              | The hard mix blend mode draws as normal.                |
| `audio-layer`, `camera-layer`, `data-layer`, `layer-type` | The layer type is ignored.                              |
| `shape-item`                                              | A shape item type is not supported.                     |

Expressions are never evaluated. A file whose motion depends on them plays the
keyframes it stores.

## Play it

`LottiePlayer` is a clock. It has no timers. Call `advance(dtMs)` once per frame
and read the frame it returns.

```ts
import { LottiePlayer } from '@src/stargazer'

const player = new LottiePlayer(anim, { looping: true, autoplay: true })
player.events.on('loop', ({ count }) => console.log('loop', count))

// In an update step:
const { frame, changed } = player.advance(dtMs)
if (changed) redraw(frame)
```

`frame` counts from zero at the animation's in point. `changed` is false when
the frame is the same as the last call, so a caller can skip re-evaluating.

Options and controls:

- `mode`: `'forward'`, `'reverse'`, `'bounce'` or `'reverse-bounce'`.
- `speed` (above 0) and `looping`. `loopCount` of N plays N times in total, and 0
  means forever.
- `useFrameInterpolation`: `false` rounds to whole frames.
- `setSegment(start, end)` limits playback to a frame range.
  `setMarker(name)` limits it to a marker.
- `play()`, `pause()`, `stop()` and `seek(frame)`.

Events: `frame`, `render`, `loop`, `complete`, `play`, `pause` and `stop`.

An infinite bounce emits `loop` once per full forward and backward cycle.

## Put it in a scene

`LottieNode` is a normal scene node that plays an animation and draws it.

```ts
import { LottieNode, parseLottie } from '@src/stargazer'

const spinner = new LottieNode({
  animation: parseLottie(json),
  width: 96,
  height: 96,
})
spinner.transform.x = 200
scene.root.add(spinner)
spinner.player.events.on('loop', ({ count }) => console.log(count))
```

The node's origin is the top-left corner of its `width` by `height` box, and the
composition is fitted into the box with `fit` (default `'contain'`) and
`alignX` and `alignY`. Without a size the box is the composition size. The node
implements the layout interface, so it can sit in a `Row`, `Column` or `Box`.

Options: `autoplay` and `looping` (both default `true`), `loopCount`, `speed`,
`mode`, `segment`, `useFrameInterpolation` and `offscreen`. With `offscreen:
'freeze'` the animation stops advancing while the node is not drawn (culled or
hidden) and resumes where it left off. The default `'advance'` keeps time
running.

Methods: `play()`, `pause()`, `stop()`, `seek(frame)`, `setSegment(start, end)`
and `setMarker(name)`. Read `currentFrame`, `totalFrames`, `markers` and
`diagnostics`.

The node samples the animation only when the playback frame changed, so a paused
animation costs only its draw calls. Its path data is built once and reused.
Opacity is folded into each shape, except for a layer whose shapes overlap, which is composited as a unit (`opacityMode: 'exact'`, the default). `opacityMode: 'fold'` folds it everywhere, which is cheaper. `transform.alpha` on the node scales the
whole animation, and like every node alpha it does not cascade to other nodes.

### What is drawn

Drawn: shape, solid, null and precomposition layers, parenting, paths,
rectangles (with rounded corners), ellipses, polygons and stars, solid fills and
linear and radial gradient fills (with highlight), solid and gradient strokes with dashes, caps and joins, fill rules, layer and group transforms with skew,
layer timing and time remapping, and the trim paths, repeater, round corners, pucker and bloat modifiers, and merge paths for union (merge, add) and exclude intersections. A modifier also shapes the groups listed above it, so a trim after a group trims that group's strokes. The composition is clipped to its own bounds, precompositions to theirs, a layer with a single additive mask to that mask's shape, and every other mask mode that is a union, subtraction or intersection (with inversion and opacity, plus lighten, darken and difference as their hard-edge equivalents) through coverage surfaces. Track mattes (alpha, inverted alpha, luma, inverted luma), the multiply, screen and add blend modes, and exact layer opacity use offscreen surfaces too.

Text layers draw each character from the glyph outlines the file embeds (the usual export when fonts are converted to outlines), in the document's fill color, with its size, tracking, line height and justification. Characters the file has no outline for draw with the platform font named in the file, so that font has to be available to the page. The document that applies is the last one whose frame has passed.

Image layers draw their picture once it has loaded. The node resolves each image with `assetResolver` (given the file name, folder and whether the file embeds it, return a URL, a `Blob` or bytes) and decodes it with `imageDecoder`. The default fetches a URL joined from `baseUrl`, the folder and the file name, uses an embedded data URI as it is, and decodes with `createImageBitmap`. For a `.lottie` file, `assetResolver: (img) => file.getImage(img.path) ?? ''` reads the pictures from the archive. A picture that fails to load adds an `image-missing` diagnostic and the layer stays empty.

Not drawn yet, and listed in `diagnostics` with a code starting `unsupported-`:
mask expansion, the other blend modes (they draw as normal), auto-orient, the offset path, zig-zag and
twist modifiers, merge paths subtract and intersect, text animators, text on a path and text strokes.
Star roundness is ignored. A stroke with butt or square caps, or a miter or
bevel join, goes through the slower outline stroker. Gradient strokes always do.

## Fit it into a box

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

`fit` is `'contain'`, `'cover'`, `'fill'`, `'fit-width'`, `'fit-height'` or
`'none'`. Alignment is a number from 0 to 1 or `'start'`, `'center'`, `'end'`.

## Load a `.lottie` file

A `.lottie` file is a zip with a manifest, animations, themes, and the images and
fonts they use. `loadDotLottie` fetches and opens one, and `parseDotLottie` opens
bytes you already have.

```ts
import { loadDotLottie, LottieNode } from '@src/stargazer'

const file = await loadDotLottie('/emoji.lottie')
const node = new LottieNode({ animation: file.getAnimation() })
node.setTheme(file.getTheme('dark'))
```

`getAnimation(id?)` parses the animation afresh on every call, so two nodes can
hold the same animation with different themes. `loadLottie(url)` does the same
for a plain JSON file, and both share one fetch per URL. Reading a `.lottie`
file needs `DecompressionStream('deflate-raw')` (Safari 16.4, Firefox 113,
current Chrome). ZIP64 and encrypted archives are rejected.

## Themes and slots

A slot is a property the animation gives an id. A theme is a list of rules that
set slots, and `setSlots` sets them directly.

```ts
node.setTheme(file.getTheme('dark')) // slots the theme names change
node.setTheme(null) // back to the file's colors
node.setSlots({ 'body-main': { type: 'Color', value: [1, 0.2, 0] } })
node.resetSlots()
```

A rule or slot value is one of `Color` (`[r, g, b, a?]` in 0 to 1), `Scalar`,
`Vector`, `Position` or `Gradient` (a list of `{ offset, color }`). `Color`,
`Scalar`, `Vector` and `Position` can also give `keyframes`
(`{ frame, value, inTangent?, outTangent?, hold? }`). A rule with an
`animations` list applies only to those animations when you pass the animation
id to `setTheme`. Switching themes always starts from the file's own values, so
nothing is left over from an earlier theme. The alpha of a theme color is
ignored, and text and image slots are not supported.

A theme changes the animation object the node holds. Give each node that should
look different its own parse of the animation.

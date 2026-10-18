# Dithering art

The dither effect turns an image, an animation or a drawn scene into the bitmap
look of Mozilla's brand: halftone dots, ordered dither, blue-noise stipple and
error diffusion. It is a stargazer post effect, so it runs over a `Layer` and
works in every display.

The effect lives in `src/core/render/dither/`. The age verification display uses
it for its background, its illustrations and its splash animation.

## Basic usage

Put a `Dither` in the `effects` of a layer. Everything under the layer is
dithered, and nothing else is.

```ts
import { Layer } from '@src/stargazer'
import { Dither, ditherPreset } from '@src/core/render/dither'

const art = new Layer({
  id: 'art',
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
  region: 'view',
  cache: 'raster',
  effects: [new Dither(ditherPreset('stageMountain'))],
})
engine.tree.root.add(art)
art.warm()
```

The scene needs a current `CameraNode2D`, or the engine draws no layers.

To dither the whole canvas instead, add the effect to the stage with
`engine.postProcess.add(new Dither(...))`. Its unit is then one CSS pixel, since
the stage has no frame of its own.

A static layer should set `cache: 'raster'`. The layer then runs the effect once
and draws the result until something under it changes. A layer that moves or
animates runs it every frame.

### Presets

`ditherPreset(name, overrides)` returns a full set of settings. The names are
the nine looks of the brand references:

| Preset                   | Look                                                 |
| ------------------------ | ---------------------------------------------------- |
| `halftoneSphere`         | Round dots that grow with the shade                  |
| `bitmapPaletteMegaphone` | Coarse ordered dither snapped to green and orange    |
| `bitmapPaletteFlower`    | Coarse 2 by 2 dither snapped to purple and green     |
| `errorDiffusionGlobe`    | Atkinson error diffusion, one-bit pixels             |
| `blueNoiseGlobe`         | Blue-noise pixels, for moving content                |
| `stippleCloud`           | Round dots of one size, thicker where it is brighter |
| `stageMountain`          | Fine ordered dither with inset squares               |
| `paperMountain`          | Fine ordered dither, small grey dots on white        |
| `overlayStipple`         | Stipple with clear gaps, to draw over live content   |

The preset colors are `KIT_COLORS`, picked by eye from the reference images. Pass
`paper`, `ink` and `colors` to use a display's own:

```ts
new Dither(ditherPreset('stippleCloud', { paper: '#ffffff', ink: '#ff453f' }))
```

### Try settings in the browser

Open `/?dither` for a page with a preset picker, every setting, three test
images, a switch between WebGPU and WebGL2, and a toggle that moves the image.
The address also takes `preset`, `source` (`blob`, `sphere` or `flower`),
`motion=on`, `cache=on`, `gfx=webgpu` or `webgl2`, `target=stage` to dither the
whole stage instead of a layer, and `panel=off`.

## Advanced usage

### Units and the grid

A dither is a grid of cells. Each cell takes the average color of the pixels it
covers, and one dot is drawn in it. `cellSize` is in the layer's own units, so a
layer with a 1920 by 1080 frame has the same cells on every screen. The presets
are tuned for that frame.

`anchor` decides what the grid is fixed to:

- `'screen'` (the default) keeps one grid on the canvas. Content slides under
  it, and dots switch on and off as the tone crosses them.
- `'layer'` fixes the grid to the layer's origin, so it moves with the layer.
  The pattern never crawls, but it moves in whole-pixel steps.

With `snap` on (the default) the cell and the grid origin round to whole device
pixels, which avoids shimmer in square dots.

### Patterns and dots

`pattern` decides how a cell's tone becomes ink or paper: `bayer2`, `bayer4`,
`bayer8`, `blue-noise`, `white-noise`, `gradient-noise`, `diffusion` or `none`.
`dot` decides what is drawn in the cell: `square`, `square-inset`, `circle`, or
the `circle-am` and `square-am` shapes that grow with the tone.

`palette` decides the color: `mono` blends from `paper` to `ink`, `ramp` reads
`colors` as a tone ramp from dark to light, `nearest` snaps to the closest of
`colors` after a threshold nudge of `paletteSpread`, and `source` keeps the
image's own color.

`invert` makes dark input into ink. Without it, light input is ink.

### Clear ground

Set `paper` to a transparent color and `alphaThreshold` above 0 to dither a
silhouette. Cells with less alpha than the threshold are left clear, so only the
art is drawn and what is behind the layer shows between the dots.

### Error diffusion

The `diffusion` pattern rounds each cell and passes the rounding error on to the
cells after it, so every cell depends on all the ones before. A fragment shader
cannot do that, so the effect has a data pass between the cells and the dots.

- **On WebGPU** a compute shader runs it every frame. One workgroup sweeps the
  grid in diagonal wavefronts and keeps the last five wavefronts' errors in
  workgroup memory, which limits the grid to 800 rows of cells. A 1080 unit
  high layer reaches that at a cell size under 1.4 units.
- **On WebGL2** the effect reads the cells back without waiting and runs the
  same algorithm on the CPU. The result arrives a few frames after the layer
  first draws, and until then the layer shows the paper color. A cached layer
  draws again when the result lands.

Diffusion changes completely when the input changes by one cell, so moving
content boils. Use it on a cached layer, and use `blueNoiseGlobe` for content
that moves.

### Blue noise

The blue-noise tile is built by `npm run gen:blue-noise` and committed as
`blueNoise64.gen.ts`. Run the script again after changing the generator.

### Shaders

The WGSL is in `src/core/render/dither/`, and `npm run gen:shaders` writes the
GLSL for WebGL2 next to it. `npm run check:wgsl` compiles every shader in Chrome.
`dither.inc.wgsl` holds the params block and the pattern functions. A new
pattern is a new case in `cellThreshold` in `ditherDots.wgsl` and a new name in
`params.ts`, and a new dot shape is a case in `dotCoverage`.

## See also

- [`post-processing.md`](../src/stargazer/docs/guides/post-processing.md), for
  data passes, extra textures and placement
- `src/core/render/dither/params.ts`, the settings and their defaults
- `src/dev/DitherPreview.svelte`, the page at `/?dither`

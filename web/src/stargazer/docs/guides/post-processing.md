---
title: Post-processing
group: Features
order: 16
---

# Post-processing

Post-processing runs screen-space effects over the finished frame, after the 3D
pass and every 2D layer, before the frame reaches the canvas. Each effect is one
or more fullscreen shader passes. Use it for a lens look (a {@link Vignette},
{@link ChromaticAberration}), a blur ({@link DualKawaseBlur}, {@link
VignetteBlur}) or grain ({@link FilmGrain}).

Each stage owns a {@link PostProcessPipeline}. The primary stage's is
[`engine.postProcess`](/module/engine/engine#postprocess), and a secondary
stage's is [`stage.postProcess`](/module/render/stage#postprocess). The stage
creates the pipeline on first access. While it holds no enabled effect, the
frame is presented directly, as if there were no pipeline.

## Basic usage

Add effect instances to the pipeline. This example darkens the corners and adds
a color fringe at the edges:

```ts
import { ChromaticAberration, Vignette } from '@src/stargazer'

engine.postProcess.add(new Vignette({ intensity: 0.6, radius: 0.4 }))
engine.postProcess.add(new ChromaticAberration({ amount: 0.008 }))
```

Effects run in the order you add them, and each one reads the output of the one
before. Adding the same instance twice has no effect.

### Change and remove effects

An effect's parameters are plain fields. The pipeline reads them every frame, so
you can set or animate them at any time. `add` returns the effect it was given:

```ts
const ca = engine.postProcess.add(new ChromaticAberration({ amount: 0.008 }))

ca.amount = 0.012 // takes effect on the next frame
ca.enabled = false // skipped, but kept in the pipeline
engine.postProcess.remove(ca) // removed, its GPU resources released
```

Set `enabled` to switch an effect off for a while. Call `remove` when you no
longer need it.

### Compile effects ahead of time

The first frame with an enabled effect compiles that effect's shaders. The
compile is a synchronous stall, long enough to look like the screen froze. Call
[`warm`](/module/render/postprocesspipeline#warm) while the stall is hidden,
such as during a scene load or a transition:

```ts
const pulse = engine.postProcess.add(new Vignette({ enabled: false }))
engine.postProcess.warm() // compiles every added effect, disabled ones too

// Later, with no stall:
pulse.enabled = true
```

`warm` skips passes that are already compiled, so calling it again costs
nothing. While a pass is still compiling, the stage presents the frame without
effects.

### Apply effects to part of the scene

The stage's pipeline processes the whole frame. To process only part of the
scene, put that part under a {@link Layer} and give the layer the effects. This
example blurs what lies behind a panel:

```ts
import { DualKawaseBlur, Layer } from '@src/stargazer'

const frosted = new Layer({
  effects: [new DualKawaseBlur({ levels: 3 })],
  padding: 24, // the blur spreads this far past the panel's edge
})
frosted.add(panel)
scene.root.add(frosted)
frosted.warm() // compile the passes while a stall is hidden
```

The layer draws its subtree into a surface, runs the effects over it, and draws
the result in the layer's place in tree order. What is drawn before and after
the layer is unchanged. See [Layers](/guides/scene#layers) for the layer itself.

The effects are the same classes the stage uses, with the same fields. One
effect instance can be on several layers and on the stage at once. The layer
reads its `effects` list every frame, so you can change it at any time.

## Advanced usage

This section lists the built-in effects' options, then covers custom effects,
layer details, and how the pipeline runs and what it costs.

### Built-in effects

All options are optional, and each one is also a public field you can change
live. Every effect also takes `enabled`, default `true`.

| Effect                | Option      | Default     | Meaning                                                      |
| --------------------- | ----------- | ----------- | ------------------------------------------------------------ |
| `Vignette`            | `intensity` | `0.5`       | Corner darkening, `0` (off) to `1` (black)                   |
|                       | `radius`    | `0.5`       | Distance from the center, in uv units, where it begins       |
|                       | `softness`  | `0.45`      | Width of the falloff band                                    |
| `ChromaticAberration` | `amount`    | `0.006`     | Red and blue separation at the corners, in uv units          |
| `VignetteBlur`        | `strength`  | `4`         | Blur reach at the edges, in texels                           |
|                       | `radius`    | `0.55`      | Distance from the center where the blur begins               |
|                       | `softness`  | `0.45`      | Width of the falloff band                                    |
| `DualKawaseBlur`      | `levels`    | `4`         | Depth of the downsample chain, rounded and clamped to 1 to 6 |
|                       | `offset`    | `2`         | Tap spread per pass, in texels                               |
| `FilmGrain`           | `cellPx`    | `2`         | Render-target pixels per grain cell                          |
|                       | `density`   | `0.5`       | Share of cells that carry grain, `0` to `1`                  |
|                       | `opacity`   | `0.15`      | How strongly a grain cell blends toward `tint`               |
|                       | `tint`      | `'#FCF5F0'` | CSS color of the grain                                       |
|                       | `hz`        | `0`         | New grain patterns per second, `0` for a fixed pattern       |

`Vignette`, `ChromaticAberration` and `FilmGrain` run one pass. `VignetteBlur`
runs two, a horizontal and a vertical blur, both weighted by the same radial
mask, so the center stays sharp.

`DualKawaseBlur` runs `2 * levels` passes. The down passes render at a half, a
quarter, and so on of the frame size, and the up passes grow back to full size.
Each level roughly doubles the blur radius, so animating `levels` looks like
popping. Animate `offset` for a smooth change.

All `DualKawaseBlur` level counts draw from one set of passes built when you
construct the effect. A level count used for the first time still compiles, and
`warm` covers only the current `levels`. Construct the blur at the deepest
`levels` you will use and warm it there, because every shallower chain uses a
subset of those passes.

`DualKawaseBlur` blurs gamma-encoded color, which darkens high-contrast edges
slightly. Its targets have 8 bits per channel, so a smooth result can show
bands. A `FilmGrain` after it hides them.

`FilmGrain` with `hz` above 0 reads as film on moving images and as crawling
static on a still frame.

### Write a custom effect

An effect implements {@link PostEffect}: an `enabled` flag and an ordered list
of {@link PostPass} objects. A pass is a shader, the byte size of its uniform
block, and a callback that fills that block each frame. The pipeline supplies
the fullscreen triangle, binds the input texture, and allocates the uniform
buffer.

You write shaders in WGSL. `npm run gen:shaders` generates the GLSL that the
WebGL2 backend needs. Write one WGSL module per pass, with both stages:

- `vs_main` takes `a_pos` at location 0 and `a_uv` at location 1, and passes the
  uv through unchanged.
- `fs_main` samples `u_tex` at binding 0 and reads its own `Params` block at
  binding 6.

The generator looks up the entry points by these names, so a module with other
names generates no GLSL. Copy `render/postfx/shaders/vignette.wgsl` as a
starting point.

The TypeScript side wraps the generated files with {@link postShader} and writes
the params:

```ts
import { postShader } from '@src/stargazer'
import type { PostEffect, PostPass, ShaderReflection } from '@src/stargazer'
import wgsl from './scanlines.wgsl?raw'
import vertSrc from './scanlines.gen.vert.glsl?raw'
import fragSrc from './scanlines.gen.frag.glsl?raw'
import reflect from './scanlines.reflect.json'

class Scanlines implements PostEffect {
  enabled = true
  strength = 0.2

  readonly passes: readonly PostPass[] = [
    {
      shader: postShader(vertSrc, fragSrc, wgsl, reflect as ShaderReflection),
      paramsBytes: 16, // one vec4, std140
      writeParams: (ctx, out) => {
        out[0] = this.strength
        out[1] = ctx.height
      },
    },
  ]
}

engine.postProcess.add(new Scanlines())
```

`writeParams` runs every frame and reads the effect's live fields, so `strength`
can change at any time. `paramsBytes` is the std140 size of the block. For a
pass with no parameters, set it to `0` and leave out `writeParams`.

`npm run gen:shaders` walks every `.wgsl` file under `src`, so you can keep an
effect's shader next to the code that uses it. The generated `.gen.vert.glsl`,
`.gen.frag.glsl` and `.reflect.json` files land next to the `.wgsl` file.

`npm run check:wgsl` compiles the same files with Chrome's WGSL compiler and
prints its errors. Chrome rejects some code that Firefox and the generator
accept, such as `a && b || c` without parentheses, so run it after you edit a
`.wgsl` file. It needs Chrome with WebGPU. Set `CHROME` to the browser binary
when it is not at the macOS default path.

### Texture coordinates

Take the texture coordinate from `a_uv`, not from the clip position. The two
backends disagree on which row of a sampled render target is the top. A shader
that computes `uv = a_pos * 0.5 + 0.5` samples upside down on one of them, and
every second pass in a chain draws the frame flipped. The pipeline uploads a
flipped triangle where the device needs one, so a shader that reads `a_uv` is
correct on both backends.

`ctx.uvYDown` is true when `a_uv.y` grows downward on screen (WebGPU) and false
when it grows upward (WebGL2). An effect that is symmetric around the center
never needs it. A pass with a direction or an off-center point reads it in
`writeParams` to get the same on-screen result on both backends.

### The params block

The `ctx` that {@link PostPassContext} describes holds these fields:

- `width`, `height`: the size of the target the pass draws into, in device
  pixels
- `texelW`, `texelH`: `1 / width` and `1 / height`
- `inputWidth`, `inputHeight`, `inputTexelW`, `inputTexelH`: the same for the
  texture the pass reads
- `uvYDown`: the texture direction, see above
- `time`: seconds since the pipeline started
- `dt`: the current frame's delta in seconds

**Give a `Params` block `vec4<f32>` members only.** `f32`, `vec2<f32>` and
`vec3<f32>` lay out the same way under std140 (what the generated GLSL uses) and
under WGSL's uniform rules. Larger types do not. A `mat2x2<f32>` is 16 bytes in
WGSL and 32 in std140, and array strides differ the same way. One `Float32Array`
cannot match both layouts, and WebGPU gives no error for the mismatch. Pack
smaller values into the unused components of a `vec4` instead.

### Pass size

A pass renders at the frame's full size by default. Set
[`scale`](/module/render/postpass#scale) to render at a fraction of it. The size
is `max(1, floor(frameSize * scale))` on each axis. It is always relative to the
frame the pipeline was given, not to the previous pass, so a chain can ask for
an exact fraction at every level without rounding errors adding up.

`DualKawaseBlur` is the reference: its down passes shrink and its up passes grow
back to `scale: 1`. `ctx.inputWidth` and `ctx.inputHeight` differ from `width`
and `height` exactly where `scale` changes the size.

### Color in a shader

A shader receives the frame as premultiplied, display-space (gamma) color, the
same bytes the canvas shows. Do not add sRGB conversions. Keep operations safe
for premultiplied color: multiplying by a scalar or summing samples whose
weights add up to 1 is fine.

If you offset channels separately, as `ChromaticAberration` does, keep the
output alpha at or above each color channel. Otherwise transparent edges fringe
brightly when the canvas is composited over the page.

### Effects that smooth their input

Set [`smoothsInput`](/module/render/posteffect#smoothsinput) to `true` on an
effect that removes the fine detail of its input, as a blur does.
`DualKawaseBlur` sets it.

A layer whose first enabled effect sets `smoothsInput` draws into a
single-sample surface. This saves the memory and bandwidth of a multisampled
surface, and the blur removes the edges that multisampling would have smoothed.
Leave the flag unset for an effect whose output keeps edges, such as a color
grade or grain, because those edges would lose their antialiasing. The flag has
no effect on `engine.postProcess`, which reads the already resolved frame.

The first frame that wants a single-sample surface starts compiling
single-sample pipelines for every 2D program. Until they are ready, the layer
draws multisampled.

### Layer regions

These layer options decide what a layer's effects run over:

- `region` picks the area. `'content'`, the default, is the box around what the
  layer draws. `'view'` is the whole canvas, whatever the layer draws, for a
  background that fills the screen. A `Rect` is an area in the layer's own
  space.
- `padding` adds CSS pixels on every side. An effect that spreads past what was
  drawn, such as a blur, needs it, because the effect only sees what is inside
  the region. A blur at the region's edge repeats the edge pixels.
- `clearColor` fills the region before the layer draws, as a CSS color, and the
  effects process it too. Without it the region starts transparent.

The surface is exactly the size of the region, so an effect sees the region and
not the canvas. A blur's levels, and an effect that positions things by the
width of its input, are relative to the region.

Effects on layers run before the main pass, nested layers from the inside out. A
layer inside another layer is already processed when the outer one runs.

[`effectsApplied`](/module/scene/layer#effectsapplied) reports whether the last
frame drew the subtree with every effect. It is false while an effect's
pipelines are still compiling, when the subtree draws without effects, which
`warm()` avoids. It is also false for a layer that holds an `InsetViewNode` or
sits inside one, because those cannot be drawn into a surface. The engine warns
once in development.

A layer with effects renders its surface and runs its passes every frame it is
drawn, unless it keeps its result. The cost is the surface plus one fullscreen
pass per effect pass, at the region's size. The surface has the main target's
multisampling, except as described in
[Effects that smooth their input](#effects-that-smooth-their-input).

### Keep a layer's result

A layer whose content rarely changes can keep what it rendered. With
`cache: 'raster'`, the layer stores the processed result in a target of its own.
While nothing has changed, it draws that result again as one textured quad,
without drawing its subtree:

```ts
import { DualKawaseBlur, FilmGrain, Layer } from '@src/stargazer'

const backdrop = new Layer({
  space: { frame: { x: 0, y: 0, width: 1920, height: 1080 } },
  region: 'view',
  cache: 'raster',
  effects: [new DualKawaseBlur({ levels: 6 }), new FilmGrain({ hz: 0 })],
})
```

The layer renders again in these cases:

- A node under it moves, changes visibility or alpha, repaints, is added,
  removed or reordered, or changes how it composites or clips.
- An effect's parameters change, including grain with `hz` above 0 at its own
  rate, or an effect is enabled, disabled or swapped.
- The canvas, the layer's view, its region or its padding changes. Under a
  `'world'` layer this includes a camera pan or zoom. A `'screen'` or frame
  layer does not follow the camera.
- You call [`invalidate()`](/module/scene/layer#invalidate), for a change that
  none of the above catches.

The layer applies its own `alpha` when it draws the kept result, so fading a
cached layer does not render it again. Three things make a cached layer render
every frame, and the engine warns once in development: a node that draws
immediately with `draw` instead of `paint`, a matte, and a nested layer with
effects. A cached layer without effects runs a copy pass when it renders, so its
result lands in its target.

The engine releases a kept result when the layer goes unused for a few seconds.
When the kept results exceed the cache's memory budget, the least recently used
go first. The debug HUD lists them as "Layer renders", with how many layers drew
from a kept result in the last frame.

### How the pipeline runs

When at least one effect is enabled, the stage draws the frame into its
offscreen target and does not present it. The pipeline resolves that target
(multisampled to a single-sample texture you can sample) and runs each pass as a
fullscreen draw. The passes alternate between two pooled targets. When the frame
is drawn in the canvas format and the last pass renders at full size, that pass
draws into the canvas directly, so no copy follows.

Passes run with depth and blending off. Each pass overwrites every pixel of its
target, which is also the correct behavior for premultiplied color. GPU
resources build on first use and rebuild after a context loss.

A device-wide cache holds each pass's compiled shader and pipelines, so a pass
used in several places compiles once. Each owner (the stage's pipeline and every
layer with effects) runs the passes in its own chain. A chain owns each pass's
params buffer, its own `time`, and the change detection for kept results. Two
chains running the same effect in one frame therefore write separate buffers.
That matters on WebGPU, where only the last write to a buffer before a submit
takes effect.

Fog is not a post-processing effect. The 3D shaders apply it per fragment,
because it needs each surface's depth and must mix with the depth-sorted
transparent draws. See [Fog](/guides/3d#fog).

### Cost

Each pass is one fullscreen draw. Most built-in effects run one or two passes at
full size. `DualKawaseBlur` runs `2 * levels` passes, most of them at a fraction
of the frame size, as described in
[this write-up](https://blog.frost.kiwi/dual-kawase/#dual-kawase-blur) on the
technique.

The render target pool is keyed by size and frees a size it stops seeing.
Targets that an effect at several sizes used cost nothing once it stops asking
for them. A pass that no effect has listed for 240 frames releases its compiled
pipelines.

The dev demo `?demo=postfx` runs a blur and grain on the stage and a blur on a
layer.

## See also

- {@link PostProcessPipeline}: the stage's list of effects
- {@link PostEffect}: the interface a custom effect implements
- {@link PostPass}: one fullscreen pass and its params
- {@link postShader}: wraps a pass's generated shader files
- {@link Layer}: effects on a subtree
- {@link DualKawaseBlur}: the downsample blur
- [Scene graph](/guides/scene): layers and the tree
- [3D](/guides/3d): fog and the 3D pass
- [Ambient occlusion](/guides/ambient-occlusion): screen-space shading inside
  the 3D pass

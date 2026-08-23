# Post-processing

Post-processing runs screen-space effects over the fully composited frame, after the 3D pass and
every 2D layer, by re-rendering it through fullscreen shader passes before it reaches the canvas.
Each stage owns a pipeline. Reach the primary stage's through `engine.postProcess` (or
`stage.postProcess` for a secondary stage). It is created on first access and costs nothing until it
holds an enabled effect: with an empty or all-disabled pipeline the frame takes the normal direct
present path unchanged.

Enabling an effect is not free the first time, though. The stage leaves the direct present path and
the pass's shaders compile in that same frame, a synchronous stall long enough to read as the screen
flickering. Call `postProcess.warm()` somewhere the cost is hidden (a scene load, a transition) to
compile every added effect, disabled ones included, ahead of the first pulse. It is the counterpart
to `Gfx2D.warmText` and is idempotent.

```ts
import { Vignette, ChromaticAberration } from '@src/stargazer'

engine.postProcess.add(new Vignette({ intensity: 0.6, radius: 0.4 }))
const ca = engine.postProcess.add(new ChromaticAberration({ amount: 0.008 }))

ca.amount = 0.012 // parameters are plain fields, read fresh every frame
engine.postProcess.remove(ca) // add/remove at any time
```

Effects run in the order they were added, each reading the previous one's output.

## Built-in effects

- **`Vignette`**: darkens toward the edges by a smooth radial falloff. `intensity` (`0`..`1` corner
  darkening), `radius` (where it begins, in uv distance from center), `softness` (falloff width).
- **`ChromaticAberration`**: splits the red/blue channels outward from the center, growing toward
  the edges, for a lens-fringe look. `amount` (peak channel separation in uv units at the corners).
- **`VignetteBlur`**: edge-weighted blur, sharp in the center, blurring toward the periphery (a
  focus/lens look that pairs with `Vignette`). Two separable passes. `strength` (max blur reach in
  texels at the edges), `radius`, `softness` (the same radial-mask controls as `Vignette`).

All parameters are public fields, safe to tweak or animate at runtime.

## Writing a custom effect

An effect is a `PostEffect`: an `enabled` flag and an ordered list of `PostPass`es.
A pass is a shader plus the size of its uniform block and a callback that fills
that block each frame. The pipeline supplies the fullscreen triangle, binds the
input texture, and allocates the params buffer.

Shaders are authored in WGSL, and the GLSL the WebGL2 backend needs is generated
by `npm run gen:shaders`. Write one WGSL module per pass holding both stages:

- `vs_main` takes `a_pos` at location 0 and `a_uv` at location 1, and passes the
  uv straight through.
- `fs_main` samples `u_tex` at binding 0 and reads its own `Params` block at
  binding 6.

Take the texture coordinate from `a_uv`. Do not derive it from the clip
position. The two backends disagree on which row of a sampled render target is
the top, so `uv = a_pos * 0.5 + 0.5` samples upside down on one of them and
every odd-numbered ping-pong pass renders the frame flipped. The pipeline uploads
a V-flipped triangle where the device needs one, so a shader that reads `a_uv` is
correct on both and pays nothing for it. Copy `shaders/vignette.wgsl` as the
starting point.

The TypeScript side wires the generated artifacts together with `postShader` and
writes the params:

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

`writeParams` runs every frame and reads the effect's live fields, so a
parameter can be tweaked or animated with nothing to re-initialize. `paramsBytes`
is the std140 size of the block, and member offsets are yours to get right. Set
it to `0` and omit `writeParams` for a pass with no parameters. `ctx` carries the
target's width, height, reciprocal texel size, elapsed seconds, and frame delta.

A shader receives the frame as **premultiplied, display-space (gamma) color**,
the same bytes the canvas shows. Keep operations premultiplied-safe: a scalar
multiply or a unit-weight sample sum is fine. If you offset channels
independently, as chromatic aberration does, keep the output alpha at or above
the color channels or transparent edges fringe additively when composited over
the page. Do not add sRGB conversions, because the color is already
display-space.

## How it works

When at least one effect is enabled, the stage submits the frame into its offscreen target **without
presenting**, then the pipeline: resolves that target (MSAA → a sampleable single-sample texture),
runs each pass as a fullscreen draw ping-ponging between two pooled targets, and blits the final
result to the canvas. Passes run with depth and blending **disabled**: each overwrites every pixel,
so targets are neither cleared nor blended (the fastest path, and the correct one for premultiplied
color). GPU resources build lazily and rebuild after a context loss. While a pass pipeline is still
compiling, the pipeline presents the frame unmodified rather than dropping it.

Fog is deliberately **not** a post-process effect: it is applied per-fragment inside the 3D shading
pass (see the [3D guide](/guides/3d#fog)) because it needs per-surface world-space depth and must
interleave with the depth-sorted transparent draws. A screen-space fog would need a depth readback
and would mishandle transparency.

## Cost and scaling

Each pass is one fullscreen draw over the frame. The built-ins are one or two passes. The render
target pool is size-keyed, so it also accommodates multi-resolution effects: a future
downsample/upsample **Dual Kawase** blur or bloom (a bandwidth-efficient, motion-stable Gaussian,
see [this write-up](https://blog.frost.kiwi/dual-kawase/#dual-kawase-blur)) would slot in as a new
effect requesting half/quarter-resolution targets, without changing the core.

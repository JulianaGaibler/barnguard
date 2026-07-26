# Post-processing

Post-processing runs screen-space effects over the fully composited frame — after the 3D pass and
every 2D layer — by re-rendering it through fullscreen shader passes before it reaches the canvas.
Each stage owns a pipeline; reach the primary stage's through `engine.postProcess` (or
`stage.postProcess` for a secondary stage). It is created on first access and costs nothing until it
holds an enabled effect: with an empty or all-disabled pipeline the frame takes the normal direct
present path unchanged.

```ts
import { Vignette, ChromaticAberration } from '@src/stargazer'

engine.postProcess.add(new Vignette({ intensity: 0.6, radius: 0.4 }))
const ca = engine.postProcess.add(new ChromaticAberration({ amount: 0.008 }))

ca.amount = 0.012 // parameters are plain fields, read fresh every frame
engine.postProcess.remove(ca) // add/remove at any time
```

Effects run in the order they were added, each reading the previous one's output.

## Built-in effects

- **`Vignette`** — darkens toward the edges by a smooth radial falloff. `intensity` (`0`..`1` corner
  darkening), `radius` (where it begins, in uv distance from center), `softness` (falloff width).
- **`ChromaticAberration`** — splits the red/blue channels outward from the center, growing toward
  the edges, for a lens-fringe look. `amount` (peak channel separation in uv units at the corners).
- **`VignetteBlur`** — edge-weighted blur: sharp in the center, blurring toward the periphery (a
  focus/lens look that pairs with `Vignette`). Two separable passes. `strength` (max blur reach in
  texels at the edges), `radius`, `softness` (the same radial-mask controls as `Vignette`).

All parameters are public fields, safe to tweak or animate at runtime.

## Writing a custom effect

An effect is a `PostEffect`: an `enabled` flag and an ordered list of `PostPass`es. Each pass is a
fragment shader that samples the input as `u_tex` plus a `bind` callback that sets its own uniforms.
The pipeline supplies the shared vertex stage and fullscreen triangle, binds `u_tex`, and hands
`bind` a `PostPassContext` (target size, texel size, elapsed time, frame delta). Read the effect's
parameter fields inside `bind` so changes take effect immediately.

```ts
import type { PostEffect, PostPass } from '@src/stargazer'
import fragSrc from './scanlines.frag.glsl?raw' // samples u_tex, writes outColor

class Scanlines implements PostEffect {
  enabled = true
  strength = 0.2
  readonly passes: PostPass[] = [
    {
      fragmentSrc: fragSrc,
      bind: (device, program, ctx) => {
        device.setUniform1f(program, 'u_strength', this.strength)
        device.setUniform1f(program, 'u_height', ctx.height)
      },
    },
  ]
}

engine.postProcess.add(new Scanlines())
```

A shader receives the frame as **premultiplied, display-space (gamma) color** — the same bytes the
canvas shows. Keep operations premultiplied-safe: a scalar multiply or a unit-weight sample sum is
fine; if you offset channels independently (like chromatic aberration) make sure the output alpha
stays ≥ the color channels, or transparent edges will fringe additively when composited over the
page. Do not add sRGB/linear conversions — the color is already display-space.

## How it works

When at least one effect is enabled, the stage submits the frame into its offscreen target **without
presenting**, then the pipeline: resolves that target (MSAA → a sampleable single-sample texture),
runs each pass as a fullscreen draw ping-ponging between two pooled targets, and blits the final
result to the canvas. Passes run with depth and blending **disabled** — each overwrites every pixel,
so targets are neither cleared nor blended (the fastest path, and the correct one for premultiplied
color). GPU resources build lazily and rebuild after a WebGL context loss.

Fog is deliberately **not** a post-process effect: it is applied per-fragment inside the 3D shading
pass (see the [3D guide](/guides/3d#fog)) because it needs per-surface world-space depth and must
interleave with the depth-sorted transparent draws — a screen-space fog would need a depth readback
and would mishandle transparency.

## Cost and scaling

Each pass is one fullscreen draw over the frame; the built-ins are one or two passes. The render
target pool is size-keyed, so it also accommodates multi-resolution effects: a future
downsample/upsample **Dual Kawase** blur or bloom (a bandwidth-efficient, motion-stable Gaussian —
see [this write-up](https://blog.frost.kiwi/dual-kawase/#dual-kawase-blur)) would slot in as a new
effect requesting half/quarter-resolution targets, without changing the core.

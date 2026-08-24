# Combined depth and stencil on one target

A stage's render target carries depth and stencil on one attachment, so a scene
can hold 3D content and 2D chrome built from translucent multi-segment strokes
at the same time. This describes how the two stay matched, and where the
combination is deliberately not available.

## Why a pipeline has to know

A pipeline bakes the depth-stencil format of the attachment it draws into.
WebGPU rejects a pipeline whose format differs from the pass's attachment, so
every pipeline sharing a pass has to name the same one, including the 2D
pipelines that test neither aspect.

`PipelineDesc.depthStencil` is where a pipeline says so. Omitted, it resolves to
whatever `depth` and `stencil` imply, which is right whenever a pipeline uses
every aspect its target carries. A 2D pipeline drawing into a combined
attachment sets it to `'depth-stencil'` and leaves both states null. The backend
supplies the inert half: writes off and an always-pass comparison for depth, an
all-`keep` zero-write-mask state for stencil. No caller writes one by hand.

`resolveDepthStencil` in `render/gfx/depthStencil.ts` is the single resolution
both backends and `pipelineKey` call. A cache key that resolved a descriptor
differently from the backend compiling it would hand back a pipeline the pass
rejects, so the format is folded into the key from the same function.

## The three formats

| Aspects         | WebGPU                 | WebGL2             |
| --------------- | ---------------------- | ------------------ |
| `stencil`       | `stencil8`             | `STENCIL_INDEX8`   |
| `depth`         | `depth24plus`          | `DEPTH24_STENCIL8` |
| `depth-stencil` | `depth24plus-stencil8` | `DEPTH24_STENCIL8` |

A stencil-only attachment is a quarter of a combined one, which is what a
pure-2D stage wants, so only a target asking for both gets the combined format.
WebGL2 has no cheaper depth-only renderbuffer worth having, so depth there is
packed either way.

## The attachment drives the pass

`WebGPUDevice.beginRenderPass` builds one `depthStencilAttachment` from the
target's own format rather than from which of `depth` / `stencil` the caller
filled in. WebGPU rejects a pass that omits ops for an aspect the format carries
and equally one that supplies ops for an aspect it lacks, so nothing else is a
safe thing to drive it from.

An aspect the caller described nothing for is cleared, not loaded. A load is
legal, since WebGPU zero-initializes lazily, but it leaves depth at `0.0`, and
with the engine's `less-equal` default that fails for every fragment and makes
3D content vanish with no error to trace it by.

## Swapping the attachment

`GpuGfx.enableDepth` and `GpuGfx.disableDepth` route through one `#retarget`,
which rebuilds the target and re-warms every pipeline when the resolved format
changed. `Stage.render` attaches depth while the scene holds 3D content and
releases it when the last 3D node leaves, keyed on `tree.has3D`, which is
structural rather than visibility-based so it does not toggle while a scene
hides its meshes.

The release is memory hygiene rather than a way to get the stencil back. A stage
outlives the scenes drawn on it, so holding a depth attachment after the last 3D
node would keep it for the rest of the booth's life.

Both calls sit ahead of the readiness gate in `Stage.render` on purpose. The
swap invalidates every pipeline baked against the old attachment, so the frame
that triggers it is the frame that gets skipped. The first swap on a stage pays
a real compile. Later ones hit the device pipeline cache and cost about a frame.

## Where it is not available

A target allocated with `depthSampled` (the ambient-occlusion G-buffer) takes
the depth aspect alone, and stencil asked for alongside it is neither allocated
nor reported. WebGL2 samples depth only from a `DEPTH_COMPONENT24` texture,
which holds no stencil bits, so reporting otherwise would diverge from WebGPU
for the same options.

## Verifying it

`?demo=shapes3d` draws a translucent multi-segment stroke over a 3D scene, and
`T` detaches and re-attaches the 3D content. The stroke reads as one even band
in both states, on `?gfx=webgpu` and `?gfx=webgl2` alike.

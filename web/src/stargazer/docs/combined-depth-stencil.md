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

## What the stencil bits mean

The 2D renderer divides each 8-bit stencil value so that fills, clip paths and
translucent strokes can overlap without clobbering each other.

| Bits | Holds                                                               |
| ---- | ------------------------------------------------------------------- |
| 7..5 | Clip depth `D` (0 to 7). A pixel is inside when its bits equal `D`. |
| 4    | Flag, set by a translucent stroke while it paints a pixel.          |
| 3..0 | Winding count modulo 16. Non-zero only between a fan and its cover. |

Anything that writes stencil outside the 2D renderer (a 3D pass) has to leave
bits 7..5 at zero where 2D content starts.

`render/gfx/stencilRecipe.ts` holds one row per operation. WebGPU bakes the
compare function, the operations and the masks into the pipeline and keeps only
the reference dynamic, so every row is its own pipeline variant. `D` is the
current clip depth. `less` passes when `(ref & readMask) < (stencil & readMask)`.

| Row                | Compare / reference / read mask                     | Operations / write mask                            | Color |
| ------------------ | --------------------------------------------------- | -------------------------------------------------- | ----- |
| Draw inside a clip | `equal` / `D<<5` / `0xE0`                           | keep / `0x00`                                      | on    |
| Fan, nonzero       | `equal` / `D<<5` / `0xE0`                           | front increment-wrap, back decrement-wrap / `0x0F` | off   |
| Fan, even-odd      | `equal` / `D<<5` / `0xE0`                           | invert / `0x01`                                    | off   |
| Cover              | `not-equal` / `0` / `0x0F` (even-odd `0x01`)        | pass and fail zero / `0x0F`                        | on    |
| Clip apply         | `not-equal` / `(D+1)<<5` / `0x0F` (even-odd `0x01`) | pass replace / `0xFF`                              | off   |
| Clip pop           | `less` / `((D-1)<<5) \| 0x1F` / `0xFF`              | pass replace / `0xE0`                              | off   |
| Stroke mark        | `equal` / `D<<5` / `0xF0`                           | pass invert / `0x10`                               | on    |
| Stroke reset       | `equal` / `(D<<5) \| 0x10` / `0xF0`                 | pass invert / `0x10`                               | off   |

A fan is never recorded without its cover, and the pair comes from one buffer
reservation, so a dropped draw drops both. That keeps the winding bits zero
everywhere outside the pair. The fan's write mask confines carries and borrows
to the winding bits.

A fill's fan is a set of triangles from the first point of each contour, written
with the same vertex layout as every other `coloredTri` draw. The cover is a
device-space quad over the path's bounds clipped to the target, so a path with a
small visible part costs a small cover.

## Verifying it

`?demo=shapes3d` draws a translucent multi-segment stroke over a 3D scene, and
`T` detaches and re-attaches the 3D content. The stroke reads as one even band
in both states, on `?gfx=webgpu` and `?gfx=webgl2` alike.

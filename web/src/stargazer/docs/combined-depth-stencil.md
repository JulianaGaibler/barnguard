---
title: Combined depth and stencil
group: Internals
order: 23
---

# Combined depth and stencil on one target

A stage's render target carries depth and stencil on one attachment. A scene can then hold 3D content and 2D strokes that use the stencil, such as translucent multi-segment strokes, at the same time. Every pipeline and pass has to match that attachment's format, and a few targets cannot have the combination.

## Why a pipeline has to know

A pipeline bakes in the depth-stencil format of the attachment it draws into. WebGPU rejects a pipeline whose format differs from the pass's attachment. So every pipeline that shares a pass has to name the same format, including the 2D pipelines that test neither depth nor stencil.

`PipelineDesc.depthStencil` is where a pipeline names it. When it is omitted, the format follows from `depth` and `stencil`, which is right whenever a pipeline uses every aspect its target carries. A 2D pipeline drawing into a combined attachment sets it to `'depth-stencil'` and leaves both states null. The backend supplies the inert half: writes off and an always-pass comparison for depth, and all-`keep` operations with a zero write mask for stencil. No caller writes these by hand.

`resolveDepthStencil` in `render/gfx/depthStencil.ts` is the one function both backends and `pipelineKey` call. A cache key that resolved a descriptor differently from the backend compiling it would hand back a pipeline the pass rejects. So the format goes into the key through the same function.

## The three formats

| Aspects         | WebGPU                 | WebGL2             |
| --------------- | ---------------------- | ------------------ |
| `stencil`       | `stencil8`             | `STENCIL_INDEX8`   |
| `depth`         | `depth24plus`          | `DEPTH24_STENCIL8` |
| `depth-stencil` | `depth24plus-stencil8` | `DEPTH24_STENCIL8` |

A stencil-only attachment is a quarter of the size of a combined one, which is what a pure-2D stage needs. Only a target that asks for both gets the combined format. WebGL2 has no cheaper depth-only renderbuffer worth using, so depth there is packed with stencil either way.

## The attachment drives the pass

`WebGPUDevice.beginRenderPass` builds one `depthStencilAttachment` from the target's own format, not from which of `depth` and `stencil` the caller filled in. WebGPU rejects a pass that omits operations for an aspect the format carries. It also rejects one that supplies operations for an aspect the format lacks. The target's format is the only safe source.

An aspect the caller described nothing for is cleared, not loaded. A load would be legal, because WebGPU zero-initializes lazily. But it leaves depth at `0.0`, and with the engine's `less-equal` default every fragment fails the test. 3D content then vanishes with no error to trace.

## Swapping the attachment

`GpuGfx.enableDepth` and `GpuGfx.disableDepth` both go through one `#retarget`. It rebuilds the target, and warms every pipeline again when the resolved format changed.

`Stage.render` attaches depth while the scene holds 3D content or the 3D debug camera is active, and releases it when neither is true. The check uses `tree.has3D`, which is structural, not based on visibility. So the attachment does not toggle while a scene hides its meshes.

The release frees memory. The stencil bits stay either way. A stage outlives the scenes drawn on it, so a depth attachment held after the last 3D node would stay allocated for the rest of the stage's life.

Both calls sit ahead of the readiness gate in `Stage.render` on purpose. The swap invalidates every pipeline baked against the old attachment, so the frame that triggers it is the frame that gets skipped. The first swap on a stage pays for a real compile. Later swaps hit the device's pipeline cache instead of compiling again.

## Where it is not available

A target allocated with `depthSampled`, such as the ambient-occlusion G-buffer, takes the depth aspect alone. Stencil requested alongside it is neither allocated nor reported. WebGL2 samples depth only from a `DEPTH_COMPONENT24` texture, which holds no stencil bits. Reporting stencil there would make WebGL2 differ from WebGPU for the same options.

## What the stencil bits mean

The 2D renderer divides each 8-bit stencil value so that fills, clip paths and translucent strokes can overlap without overwriting each other's bits.

| Bits | Holds                                                               |
| ---- | ------------------------------------------------------------------- |
| 7..5 | Clip depth `D` (0 to 7). A pixel is inside when its bits equal `D`. |
| 4    | Flag, set by a translucent stroke while it paints a pixel.          |
| 3..0 | Winding count modulo 16. Non-zero only between a fan and its cover. |

Anything that writes stencil outside the 2D renderer, such as a 3D pass, has to leave bits 7..5 at zero where 2D content starts.

`render/gfx/stencilRecipe.ts` holds one row per operation. WebGPU bakes the compare function, the operations and the masks into the pipeline, and keeps only the reference dynamic. So every row is its own pipeline variant. In the table, `D` is the current clip depth. `less` passes when `(ref & readMask) < (stencil & readMask)`.

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

A translucent stroke draws three passes over the same instances. The core pass and the fringe pass both use the stroke mark row, and the reset pass clears the flag again with color writes off.

A fan is never recorded without its cover, and the pair comes from one buffer reservation, so a dropped draw drops both. That keeps the winding bits zero everywhere outside the pair. The fan's write mask keeps carries and borrows inside the winding bits.

A fill's fan is a set of triangles from the first point of each contour, written with the same vertex layout as every other `coloredTri` draw. The cover is a device-space quad over the path's bounds, clipped to the target, so a path with a small visible part costs a small cover.

## Verifying it

`?demo=shapes3d` draws a translucent multi-segment stroke over a 3D scene, and the `T` key detaches and re-attaches the 3D content. The stroke reads as one even band in both states. The demo runs on WebGL2 by default and on WebGPU with `?gfx=webgpu`. Check both.

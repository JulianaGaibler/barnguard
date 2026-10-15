// The shape every GPU draw program (coloredTri, stroke, shape, gradientRadial,
// maskedGradient, textQuad) implements. `GpuGfx` owns typed
// references to each concrete program (for its emit API) and also registers
// them on `GpuBatchContext` (for the generic flush dispatch).

import type { GfxDevice } from './GfxDevice'
import type { BatchKind } from './batchLayout'
import type { RingStream } from './RingStream'
import type { DrawRun, GpuBatchContext } from './GpuBatchContext'

export interface GpuProgram {
  readonly kind: BatchKind

  /**
   * The ring stream this program appends records into. The batch context reads
   * it to record draw-runs (`takeRun`), upload once per frame (`upload`), reset
   * per frame (`reset`), and orphan + restart on overflow.
   */
  readonly stream: RingStream

  /**
   * Create the backend resources that don't depend on the target format: shader
   * module, ring stream, bind group layouts, and any static bind groups. Called
   * once from `GpuGfx`'s constructor and again from `rebuildResources` after a
   * context loss, as an idempotent full recreation.
   */
  init(device: GfxDevice, ctx: GpuBatchContext): void

  /**
   * (Re)create the program's render pipelines for the batch context's current
   * target color format + sample count. Async because pipeline compilation is
   * async on WebGPU. Pre-warmed at init and re-run when the target's MSAA count
   * or format changes, never inside the frame loop.
   */
  warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void>

  /**
   * Record this run's sub-range of the (already-uploaded) ring buffer as an
   * explicit draw. Called during the frame-end command-list replay, in painter
   * order.
   */
  drawRun(ctx: GpuBatchContext, run: DrawRun): void

  /**
   * Write the device-pixel box `[minX, minY, maxX, maxY]` that covers every
   * pixel `run` can touch into `out`, or return `false` when the program can't
   * say. The batch context moves a later draw ahead of runs it does not overlap
   * to join an earlier run of the same kind, so an under-estimate puts draws in
   * the wrong order. A program that doesn't implement it is never reordered
   * past. Optional.
   */
  runBounds?(run: DrawRun, out: Float64Array): boolean

  /**
   * Stage this run's per-draw uniform slice and store its offset on the run.
   * Called for every run, in order, before any run is drawn. Optional, since
   * only programs with per-draw uniforms in a staged ring need it.
   */
  prepareRun?(ctx: GpuBatchContext, run: DrawRun): void

  /**
   * Upload the program's staged uniform rings, once, after every `prepareRun`
   * and before the first `drawRun`.
   */
  flushRings?(device: GfxDevice): void

  /**
   * Reset per-frame accumulators the program owns beyond its ring stream (e.g.
   * a dynamic-offset uniform ring, or a per-frame bind-group cache). Called
   * once per frame from the batch context's slot reset. Optional, since most
   * programs only have a stream, which the context resets directly.
   */
  resetFrame?(): void

  /**
   * Uniform-ring slices pushed this frame, for the debug HUD. Read after the
   * frame's replay. Optional, since only programs with per-draw uniforms have
   * rings.
   */
  uboSlices?(): number
}

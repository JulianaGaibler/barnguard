// The shape every GPU draw program (coloredTri, texturedQuad, stroke, sdf,
// gradientRadial, maskedGradient, textQuad) implements. `GpuGfx` owns typed
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
   * per frame (`reset`), and — on overflow — orphan + restart. Exposing the
   * stream keeps that plumbing in one place, so a program implements only
   * `init` + `drawRun`.
   */
  readonly stream: RingStream

  /**
   * (Re)create every GL resource this program owns: shader program, ring
   * stream, VAOs. Called once from `GpuGfx`'s constructor and again from
   * `rebuildResources` after `webglcontextrestored` — idempotent full
   * recreation, no incremental path.
   */
  init(device: GfxDevice, ctx: GpuBatchContext): void

  /**
   * Bind the program + this run's captured state and draw its sub-range of the
   * (already-uploaded) ring buffer. Called during the frame-end command-list
   * replay, in painter order.
   */
  drawRun(ctx: GpuBatchContext, run: DrawRun): void
}

// The shape every GPU draw program (coloredTri, texturedQuad, stroke, sdf,
// gradientRadial, maskedGradient, textQuad) implements. `GpuGfx` owns typed
// references to each concrete program (for its emit API) and also registers
// them on `GpuBatchContext` (for the generic flush dispatch).

import type { GfxDevice } from '../GfxDevice'
import type { BatchKind } from './batchLayout'
import type { GpuBatchContext } from './GpuBatchContext'

export interface GpuProgram {
  readonly kind: BatchKind

  /**
   * (Re)create every GL resource this program owns: shader program, ring
   * stream, VAOs. Called once from `GpuGfx`'s constructor and again from
   * `rebuildResources` after `webglcontextrestored` — idempotent full
   * recreation, no incremental path.
   */
  init(device: GfxDevice, ctx: GpuBatchContext): void

  /** Upload the pending ring-buffer slot and issue the draw call. */
  flush(ctx: GpuBatchContext): void

  /**
   * Clear this program's pending counters for the ring slot about to be
   * written.
   */
  resetSlot(slot: number): void
}

// Shared command-list replay for the instanced-quad programs (sdf, stroke,
// roundRect, texturedQuad, textQuad, gradientRadial, maskedGradient). Each
// program's `drawRun` binds its own per-run textures, then calls this to bind
// the program, set the projection, and draw the run's instance sub-range.

import type { AttribBinding, Program, Vao } from '../GfxDevice'
import type { RingStream } from '../RingStream'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'

/**
 * Draw one recorded run's instance sub-range. `bindTextures` (if given) runs
 * after the program is active and before the draw, for per-run samplers.
 */
export function drawInstancedRun(
  ctx: GpuBatchContext,
  program: Program,
  vaos: readonly Vao[],
  stream: RingStream,
  instanceAttribs: readonly AttribBinding[],
  strideBytes: number,
  run: DrawRun,
  bindTextures?: () => void,
): void {
  const instCount = (run.endWord - run.startWord) / (strideBytes / 4)
  if (instCount === 0) return
  ctx.device.useProgram(program)
  // Projection comes from the shared per-frame Frame UBO (bound once in
  // `submitFrame`), so no per-draw `u_proj` upload here.
  bindTextures?.()
  ctx.device.drawInstancedRange(
    vaos[ctx.curSlot],
    stream.buffers[ctx.curSlot],
    instanceAttribs,
    run.startWord * 4,
    6,
    instCount,
  )
  ctx.stats.drawCalls++
}

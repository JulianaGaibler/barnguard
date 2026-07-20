// Masked-radial-gradient program: `Gfx2D.fillMaskedRadialGradient` (the arcade
// launcher's drifting clouds). Mask silhouette on texture unit 0, gradient LUT
// on unit 1. The mask/LUT lookups live on `GpuGfx` (need `TextureManager`);
// this program owns the shader/VAO/stream plumbing and the buffer write.

import type { AttribBinding, GfxDevice, Program, Vao } from '../../GfxDevice'
import { RingStream } from '../RingStream'
import {
  LOC_MASKGRAD_DST,
  LOC_MASKGRAD_GRAD,
  LOC_MASKGRAD_SRC,
  LOC_MASKGRAD_UNIT,
  MASKED_GRAD_BUFFER_BYTES,
  MASKED_GRAD_INSTANCE_STRIDE,
  RING_SIZE,
} from '../batchLayout'
import type { GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type { Texture } from '../../GfxDevice'
import maskedGradientVertSrc from '../webgl2/shaders/maskedRadialGradient.vert.glsl?raw'
import maskedGradientFragSrc from '../webgl2/shaders/maskedRadialGradient.frag.glsl?raw'

export class MaskedGradientProgram implements GpuProgram {
  readonly kind = 'maskedGradient' as const

  #program!: Program
  #stream!: RingStream
  #vaos: Vao[] = new Array(RING_SIZE)

  init(device: GfxDevice, ctx: GpuBatchContext): void {
    this.#program = device.createProgram({
      vertexSrc: maskedGradientVertSrc,
      fragmentSrc: maskedGradientFragSrc,
      attribs: {
        a_unit: LOC_MASKGRAD_UNIT,
        a_dst: LOC_MASKGRAD_DST,
        a_srcRect: LOC_MASKGRAD_SRC,
        a_grad: LOC_MASKGRAD_GRAD,
      },
    })
    this.#stream = new RingStream(
      device,
      MASKED_GRAD_BUFFER_BYTES,
      MASKED_GRAD_INSTANCE_STRIDE,
      'maskedGradient',
    )
    this.#vaos = new Array(RING_SIZE)
    for (let slot = 0; slot < RING_SIZE; slot++) {
      const attribs: AttribBinding[] = [
        {
          buffer: ctx.unitQuadBuffer,
          location: LOC_MASKGRAD_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_MASKGRAD_DST,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: MASKED_GRAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_MASKGRAD_SRC,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 16,
          stride: MASKED_GRAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_MASKGRAD_GRAD,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 32,
          stride: MASKED_GRAD_INSTANCE_STRIDE,
          divisor: 1,
        },
      ]
      this.#vaos[slot] = device.createVao(this.#program, attribs)
    }
  }

  resetSlot(slot: number): void {
    this.#stream.reset(slot)
  }

  /**
   * Begin (or continue) the `maskedGradient` batch for `(mask, lut)` and
   * reserve one instance record; returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, mask: Texture, lut: Texture): number {
    ctx.beginBatch('maskedGradient', { texture: mask, lut })
    return this.#stream.reserveInstance(ctx.curSlot)
  }

  commitInstance(slot: number): void {
    this.#stream.commitInstance(slot)
  }

  get floatView(): Float32Array {
    return this.#stream.floatView
  }

  flush(ctx: GpuBatchContext): void {
    const slot = ctx.curSlot
    const words = this.#stream.pendingWords[slot]
    if (words === 0) return
    const instCount = this.#stream.pendingInstances[slot]
    ctx.device.updateBufferSubData(
      this.#stream.buffers[slot],
      0,
      this.#stream.floatView,
      0,
      words * 4,
    )
    ctx.device.useProgram(this.#program)
    ctx.stats.programSwitches++
    ctx.device.setUniformMat3(this.#program, 'u_proj', ctx.projMat)
    // Mask silhouette on unit 0, gradient LUT on unit 1.
    if (ctx.curTexture) {
      ctx.device.setUniformTexture(this.#program, 'u_mask', ctx.curTexture, 0)
      ctx.stats.textureBinds++
    }
    if (ctx.curLut) {
      ctx.device.setUniformTexture(this.#program, 'u_stops', ctx.curLut, 1)
      ctx.stats.textureBinds++
    }
    ctx.device.bindVao(this.#vaos[slot])
    ctx.device.drawArraysInstanced(0, 6, instCount)
    ctx.stats.drawCalls++
    this.#stream.commitFlushed(slot)
  }
}

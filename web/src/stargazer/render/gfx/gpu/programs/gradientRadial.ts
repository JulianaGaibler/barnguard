// Radial-gradient program: `Gfx2D.fillCircleRadialGradient`. The gradient LUT
// lookup lives on `GpuGfx` (needs `TextureManager`); this program owns the
// shader/VAO/stream plumbing and the buffer write. The LUT is bound as
// `ctx.curTexture` (this program has no second texture, unlike `maskedGradient`).

import type { AttribBinding, GfxDevice, Program, Vao } from '../../GfxDevice'
import { RingStream } from '../RingStream'
import {
  GRADIENT_BUFFER_BYTES,
  GRADIENT_INSTANCE_STRIDE,
  LOC_GRAD_CENTER,
  LOC_GRAD_RADALPHA,
  LOC_GRAD_UNIT,
  RING_SIZE,
} from '../batchLayout'
import type { GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type { Texture } from '../../GfxDevice'
import gradientRadialVertSrc from '../webgl2/shaders/gradientRadial.vert.glsl?raw'
import gradientRadialFragSrc from '../webgl2/shaders/gradientRadial.frag.glsl?raw'

export class GradientRadialProgram implements GpuProgram {
  readonly kind = 'gradientRadial' as const

  #program!: Program
  #stream!: RingStream
  #vaos: Vao[] = new Array(RING_SIZE)

  init(device: GfxDevice, ctx: GpuBatchContext): void {
    this.#program = device.createProgram({
      vertexSrc: gradientRadialVertSrc,
      fragmentSrc: gradientRadialFragSrc,
      attribs: {
        a_unit: LOC_GRAD_UNIT,
        a_center: LOC_GRAD_CENTER,
        a_radAlpha: LOC_GRAD_RADALPHA,
      },
    })
    this.#stream = new RingStream(
      device,
      GRADIENT_BUFFER_BYTES,
      GRADIENT_INSTANCE_STRIDE,
      'gradientRadial',
    )
    this.#vaos = new Array(RING_SIZE)
    for (let slot = 0; slot < RING_SIZE; slot++) {
      const attribs: AttribBinding[] = [
        {
          buffer: ctx.unitQuadBuffer,
          location: LOC_GRAD_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_GRAD_CENTER,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: GRADIENT_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_GRAD_RADALPHA,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 8,
          stride: GRADIENT_INSTANCE_STRIDE,
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
   * Begin (or continue) the `gradientRadial` batch for `lut` and reserve one
   * instance record; returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, lut: Texture): number {
    ctx.beginBatch('gradientRadial', { texture: lut })
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
    if (ctx.curTexture) {
      ctx.device.setUniformTexture(this.#program, 'u_stops', ctx.curTexture, 0)
      ctx.stats.textureBinds++
    }
    ctx.device.bindVao(this.#vaos[slot])
    ctx.device.drawArraysInstanced(0, 6, instCount)
    ctx.stats.drawCalls++
    this.#stream.commitFlushed(slot)
  }
}

// Text-quad program: `Gfx2D.fillText`. Draws a cached label texture as an
// affine quad, so rotation is free (no re-rasterization, just a different
// per-instance matrix). Reuses `texturedQuad`'s fragment shader; only the
// vertex stage (affine placement) differs. Label lookup lives on `GpuGfx`
// (needs `TextureManager`); this program owns the shader/VAO/stream plumbing
// and the buffer write.

import type { AttribBinding, GfxDevice, Program, Vao } from '../../GfxDevice'
import { RingStream } from '../RingStream'
import {
  LOC_TEXT_MCOL0,
  LOC_TEXT_MCOL1,
  LOC_TEXT_MTRANSLATE,
  LOC_TEXT_SRC,
  LOC_TEXT_TINT,
  LOC_TEXT_UNIT,
  RING_SIZE,
  TEXT_QUAD_BUFFER_BYTES,
  TEXT_QUAD_INSTANCE_STRIDE,
} from '../batchLayout'
import type { GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type { Texture } from '../../GfxDevice'
import textQuadVertSrc from '../webgl2/shaders/textQuad.vert.glsl?raw'
import texturedQuadFragSrc from '../webgl2/shaders/texturedQuad.frag.glsl?raw'

export class TextQuadProgram implements GpuProgram {
  readonly kind = 'textQuad' as const

  #program!: Program
  #stream!: RingStream
  #vaos: Vao[] = new Array(RING_SIZE)

  init(device: GfxDevice, ctx: GpuBatchContext): void {
    this.#program = device.createProgram({
      vertexSrc: textQuadVertSrc,
      fragmentSrc: texturedQuadFragSrc,
      attribs: {
        a_unit: LOC_TEXT_UNIT,
        a_mCol0: LOC_TEXT_MCOL0,
        a_mCol1: LOC_TEXT_MCOL1,
        a_mTranslate: LOC_TEXT_MTRANSLATE,
        a_srcRect: LOC_TEXT_SRC,
        a_tint: LOC_TEXT_TINT,
      },
    })
    this.#stream = new RingStream(
      device,
      TEXT_QUAD_BUFFER_BYTES,
      TEXT_QUAD_INSTANCE_STRIDE,
      'textQuad',
    )
    this.#vaos = new Array(RING_SIZE)
    for (let slot = 0; slot < RING_SIZE; slot++) {
      const attribs: AttribBinding[] = [
        {
          buffer: ctx.unitQuadBuffer,
          location: LOC_TEXT_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXT_MCOL0,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: TEXT_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXT_MCOL1,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 8,
          stride: TEXT_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXT_MTRANSLATE,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 16,
          stride: TEXT_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXT_SRC,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 24,
          stride: TEXT_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXT_TINT,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 40,
          stride: TEXT_QUAD_INSTANCE_STRIDE,
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
   * Begin (or continue) the `textQuad` batch for `tex` and reserve one instance
   * record; returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, tex: Texture): number {
    ctx.beginBatch('textQuad', { texture: tex })
    return this.#stream.reserveInstance(ctx.curSlot)
  }

  commitInstance(slot: number): void {
    this.#stream.commitInstance(slot)
  }

  get floatView(): Float32Array {
    return this.#stream.floatView
  }

  get uintView(): Uint32Array {
    return this.#stream.uintView
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
      ctx.device.setUniformTexture(this.#program, 'u_tex', ctx.curTexture, 0)
      ctx.stats.textureBinds++
    }
    ctx.device.bindVao(this.#vaos[slot])
    ctx.device.drawArraysInstanced(0, 6, instCount)
    ctx.stats.drawCalls++
    this.#stream.commitFlushed(slot)
  }
}

// Textured-quad program: axis-aligned image blits (`Gfx2D.drawImage`). The
// texture-atlas lookup and the rotation tripwire live on `GpuGfx` (they need
// `TextureManager` and the diagnostic counters); this program owns the
// shader/VAO/stream plumbing and the buffer write.

import type { AttribBinding, GfxDevice, Program, Vao } from '../../GfxDevice'
import { RingStream } from '../RingStream'
import {
  LOC_TEXTURED_DST,
  LOC_TEXTURED_SRC,
  LOC_TEXTURED_TINT,
  LOC_TEXTURED_UNIT,
  RING_SIZE,
  TEXTURED_QUAD_BUFFER_BYTES,
  TEXTURED_QUAD_INSTANCE_STRIDE,
} from '../batchLayout'
import type { GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type { Texture } from '../../GfxDevice'
import texturedQuadVertSrc from '../webgl2/shaders/texturedQuad.vert.glsl?raw'
import texturedQuadFragSrc from '../webgl2/shaders/texturedQuad.frag.glsl?raw'

export class TexturedQuadProgram implements GpuProgram {
  readonly kind = 'texturedQuad' as const

  #program!: Program
  #stream!: RingStream
  #vaos: Vao[] = new Array(RING_SIZE)

  init(device: GfxDevice, ctx: GpuBatchContext): void {
    this.#program = device.createProgram({
      vertexSrc: texturedQuadVertSrc,
      fragmentSrc: texturedQuadFragSrc,
      attribs: {
        a_unit: LOC_TEXTURED_UNIT,
        a_dst: LOC_TEXTURED_DST,
        a_srcRect: LOC_TEXTURED_SRC,
        a_tint: LOC_TEXTURED_TINT,
      },
    })
    this.#stream = new RingStream(
      device,
      TEXTURED_QUAD_BUFFER_BYTES,
      TEXTURED_QUAD_INSTANCE_STRIDE,
      'texturedQuad',
    )
    this.#vaos = new Array(RING_SIZE)
    for (let slot = 0; slot < RING_SIZE; slot++) {
      const attribs: AttribBinding[] = [
        {
          buffer: ctx.unitQuadBuffer,
          location: LOC_TEXTURED_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXTURED_DST,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: TEXTURED_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXTURED_SRC,
          size: 4,
          type: 'float',
          normalized: false,
          offset: 16,
          stride: TEXTURED_QUAD_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_TEXTURED_TINT,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 32,
          stride: TEXTURED_QUAD_INSTANCE_STRIDE,
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
   * Begin (or continue) the `texturedQuad` batch for `tex` and reserve one
   * instance record; returns the word offset to write into `floatView`/
   * `uintView`, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, tex: Texture): number {
    ctx.beginBatch('texturedQuad', { texture: tex })
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

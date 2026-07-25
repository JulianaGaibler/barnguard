// Radial-gradient program: `Gfx2D.fillCircleRadialGradient`. The gradient LUT
// lookup lives on `GpuGfx` (needs `TextureManager`); this program owns the
// shader/VAO/stream plumbing and the buffer write. The LUT is bound as
// `ctx.curTexture` (this program has no second texture, unlike `maskedGradient`).

import type { AttribBinding, GfxDevice, Program, Vao } from '../GfxDevice'
import { RingStream } from '../RingStream'
import {
  GRADIENT_BUFFER_BYTES,
  GRADIENT_INSTANCE_STRIDE,
  LOC_GRAD_CENTER,
  LOC_GRAD_RADALPHA,
  LOC_GRAD_UNIT,
  FRAME_UBO_BINDING,
  RING_SIZE,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type { Texture } from '../GfxDevice'
import { drawInstancedRun } from './instancedRun'
import gradientRadialVertSrc from '../webgl2/shaders/gradientRadial.vert.glsl?raw'
import gradientRadialFragSrc from '../webgl2/shaders/gradientRadial.frag.glsl?raw'

export class GradientRadialProgram implements GpuProgram {
  readonly kind = 'gradientRadial' as const

  #program!: Program
  #stream!: RingStream
  #vaos: Vao[] = new Array(RING_SIZE)
  #instanceAttribs: AttribBinding[] = []

  get stream(): RingStream {
    return this.#stream
  }

  init(device: GfxDevice, ctx: GpuBatchContext): void {
    this.#program = device.createProgram({
      vertexSrc: gradientRadialVertSrc,
      fragmentSrc: gradientRadialFragSrc,
      attribs: {
        a_unit: LOC_GRAD_UNIT,
        a_center: LOC_GRAD_CENTER,
        a_radAlpha: LOC_GRAD_RADALPHA,
      },
      uniformBlocks: { Frame: FRAME_UBO_BINDING },
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
      if (slot === 0) {
        this.#instanceAttribs = attribs.filter((a) => a.divisor === 1)
      }
    }
  }

  /**
   * Begin (or continue) the `gradientRadial` batch for `lut` and reserve one
   * instance record; returns the word offset, or `-1` on overflow.
   */
  beginInstance(ctx: GpuBatchContext, lut: Texture): number {
    ctx.beginBatch('gradientRadial', { texture: lut })
    return ctx.reserveInstance(this.#stream)
  }

  commitInstance(slot: number): void {
    this.#stream.commitInstance(slot)
  }

  get floatView(): Float32Array {
    return this.#stream.floatView
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    drawInstancedRun(
      ctx,
      this.#program,
      this.#vaos,
      this.#stream,
      this.#instanceAttribs,
      GRADIENT_INSTANCE_STRIDE,
      run,
      () => {
        if (run.texture) {
          ctx.device.setUniformTexture(this.#program, 'u_stops', run.texture, 0)
        }
      },
    )
  }
}

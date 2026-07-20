// SDF program: filled/stroked circles with optional dash. No texture; the
// batch key is blend-only.

import type { AttribBinding, GfxDevice, Program, Vao } from '../../GfxDevice'
import type { GfxStrokeStyle } from '../../Gfx2D'
import { RingStream } from '../RingStream'
import { packColor, resolveDash } from '../packing'
import {
  LOC_SDF_CENTER,
  LOC_SDF_COLORFILL,
  LOC_SDF_COLORSTROKE,
  LOC_SDF_DASH,
  LOC_SDF_RADSTROKE,
  LOC_SDF_UNIT,
  RING_SIZE,
  SDF_BUFFER_BYTES,
  SDF_INSTANCE_STRIDE,
} from '../batchLayout'
import type { GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import sdfVertSrc from '../webgl2/shaders/sdf.vert.glsl?raw'
import sdfFragSrc from '../webgl2/shaders/sdf.frag.glsl?raw'

export class SdfProgram implements GpuProgram {
  readonly kind = 'sdf' as const

  #program!: Program
  #stream!: RingStream
  #vaos: Vao[] = new Array(RING_SIZE)

  init(device: GfxDevice, ctx: GpuBatchContext): void {
    this.#program = device.createProgram({
      vertexSrc: sdfVertSrc,
      fragmentSrc: sdfFragSrc,
      attribs: {
        a_unit: LOC_SDF_UNIT,
        a_center: LOC_SDF_CENTER,
        a_radStroke: LOC_SDF_RADSTROKE,
        a_colorFill: LOC_SDF_COLORFILL,
        a_colorStroke: LOC_SDF_COLORSTROKE,
        a_dash: LOC_SDF_DASH,
      },
    })
    this.#stream = new RingStream(
      device,
      SDF_BUFFER_BYTES,
      SDF_INSTANCE_STRIDE,
      'sdf',
    )
    this.#vaos = new Array(RING_SIZE)
    for (let slot = 0; slot < RING_SIZE; slot++) {
      const attribs: AttribBinding[] = [
        {
          buffer: ctx.unitQuadBuffer,
          location: LOC_SDF_UNIT,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: 8,
          divisor: 0,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_SDF_CENTER,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 0,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_SDF_RADSTROKE,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 8,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_SDF_COLORFILL,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 16,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_SDF_COLORSTROKE,
          size: 4,
          type: 'unorm8',
          normalized: true,
          offset: 20,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
        {
          buffer: this.#stream.buffers[slot],
          location: LOC_SDF_DASH,
          size: 2,
          type: 'float',
          normalized: false,
          offset: 24,
          stride: SDF_INSTANCE_STRIDE,
          divisor: 1,
        },
      ]
      this.#vaos[slot] = device.createVao(this.#program, attribs)
    }
  }

  resetSlot(slot: number): void {
    this.#stream.reset(slot)
  }

  /** `Gfx2D.fillCircle`. */
  fillCircle(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    r: number,
    color: string,
  ): void {
    if (r <= 0) return
    // CPU transform (b/c may be non-zero under game-over EyeNode's scale, but
    // SDF renders in device px so we transform the center + scale the radius
    // by the base scale.
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    // Scale radius by the current transform's ~uniform scale factor. Use the
    // determinant's sqrt as a mean scale (correct for uniform scale; a
    // reasonable approximation for non-uniform).
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = r * Math.sqrt(det)
    this.#emitInstance(
      ctx,
      dcx,
      dcy,
      dr,
      0,
      packColor(color, ctx.stateStack.getAlpha()),
      0,
      0,
      0,
    )
  }

  /** `Gfx2D.strokeCircle`. */
  strokeCircle(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    r: number,
    style: GfxStrokeStyle,
  ): void {
    if (r <= 0 || style.width <= 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = Math.sqrt(det)
    const dr = r * scale
    const dw = style.width * scale
    const dashInfo = resolveDash(style.dash)
    this.#emitInstance(
      ctx,
      dcx,
      dcy,
      dr,
      dw,
      0,
      packColor(style.color, ctx.stateStack.getAlpha()),
      dashInfo.dashStart,
      dashInfo.dashPeriod,
    )
  }

  #emitInstance(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    radius: number,
    strokeWidth: number,
    packedFill: number,
    packedStroke: number,
    dashStart: number,
    dashPeriod: number,
  ): void {
    ctx.beginBatch('sdf')
    const slot = ctx.curSlot
    const off = this.#stream.reserveInstance(slot)
    if (off < 0) return
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    f[off + 0] = cx
    f[off + 1] = cy
    f[off + 2] = radius
    f[off + 3] = strokeWidth
    u[off + 4] = packedFill >>> 0
    u[off + 5] = packedStroke >>> 0
    f[off + 6] = dashStart
    f[off + 7] = dashPeriod
    this.#stream.commitInstance(slot)
    ctx.stats.sdfInstances++
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
    ctx.device.bindVao(this.#vaos[slot])
    ctx.device.drawArraysInstanced(0, 6, instCount)
    ctx.stats.drawCalls++
    this.#stream.commitFlushed(slot)
  }
}

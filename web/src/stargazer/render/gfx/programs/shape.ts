// Shape program: one instanced program covering circles,
// round-rects, and textured quads (text + atlas sprites). A per-instance
// `shapeType` picks the vertex positioning + fragment math. The atlas + label
// page bind at fixed units, so texture identity leaves the batch key and the
// common fill→text→shape interleave collapses to a single blend-only batch.
//
// This is the sole path for circles, round-rects, and page-backed text/sprites.
// A per-source image or an oversized dedicated label has its own texture, which
// this program does not bind, so `GpuGfx` routes those to the textQuad program.

import type { GfxStrokeStyle } from '../Gfx2D'
import type { ResolvedRadii } from '../roundRectRadii'
import { RingStream } from '../RingStream'
import { packColor, resolveDash } from '../packing'
import {
  LOC_SHAPE_COLORFILL,
  LOC_SHAPE_COLORSTROKE,
  LOC_SHAPE_MCOL0,
  LOC_SHAPE_MCOL1,
  LOC_SHAPE_MTRANSLATE,
  LOC_SHAPE_PARAMS,
  LOC_SHAPE_RADII,
  LOC_SHAPE_KIND,
  LOC_SHAPE_SRCRECT,
  LOC_SHAPE_UNIT,
  SHAPE_BUFFER_BYTES,
  SHAPE_INSTANCE_STRIDE,
  SHAPE_KIND_CIRCLE,
  SHAPE_KIND_ROUNDRECT,
  SHAPE_KIND_TEXTURED,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import type {
  BindGroup,
  BindGroupLayout,
  GfxDevice,
  Pipeline,
  ShaderModule,
  Texture,
  VertexBufferLayout,
} from '../GfxDevice'
import {
  drawInstancedRun,
  unitQuadLayout,
  warmupBlendPipelines,
} from './programCommon'
import type { ShaderReflection } from '../GfxDevice'
import shapeWgsl from '../shaders/shape.wgsl?raw'
import shapeVertSrc from '../shaders/shape.gen.vert.glsl?raw'
import shapeFragSrc from '../shaders/shape.gen.frag.glsl?raw'
import shapeReflect from '../shaders/shape.reflect.json'

/** Word offsets into the 24-word shape instance record. */
const W_MCOL0 = 0
const W_MCOL1 = 2
const W_TRANSLATE = 4
const W_SHAPE = 6 // (shapeType, feather, texIndex, pad)
const W_PARAMS = 10
const W_RADII = 14
const W_SRCRECT = 18
const W_COLORFILL = 22
const W_COLORSTROKE = 23

export class ShapeProgram implements GpuProgram {
  readonly kind = 'shape' as const

  #shader!: ShaderModule
  #stream!: RingStream
  #pipelines: Map<string, Pipeline> = new Map()
  #vertexLayout: VertexBufferLayout[] = []
  #materialLayout!: BindGroupLayout
  /** (atlas → (label → bind group)); the fixed atlas + label page textures. */
  #bindGroups = new WeakMap<Texture, WeakMap<Texture, BindGroup>>()

  get stream(): RingStream {
    return this.#stream
  }

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    this.#shader = device.createShaderModule({
      glsl: { vertex: shapeVertSrc, fragment: shapeFragSrc },
      wgsl: {
        code: shapeWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: shapeReflect as ShaderReflection,
      label: 'shape',
    })
    this.#stream = new RingStream(
      device,
      SHAPE_BUFFER_BYTES,
      SHAPE_INSTANCE_STRIDE,
      'shape',
    )
    this.#materialLayout = device.createBindGroupLayout([
      { binding: 0, type: 'texture-2d' },
      { binding: 1, type: 'texture-2d' },
    ])
    this.#bindGroups = new WeakMap()
    const s = SHAPE_INSTANCE_STRIDE
    this.#vertexLayout = [
      unitQuadLayout(LOC_SHAPE_UNIT),
      {
        arrayStride: s,
        stepMode: 'instance',
        attributes: [
          { location: LOC_SHAPE_MCOL0, format: 'float32x2', offset: 0 },
          { location: LOC_SHAPE_MCOL1, format: 'float32x2', offset: 8 },
          { location: LOC_SHAPE_MTRANSLATE, format: 'float32x2', offset: 16 },
          { location: LOC_SHAPE_KIND, format: 'float32x4', offset: 24 },
          { location: LOC_SHAPE_PARAMS, format: 'float32x4', offset: 40 },
          { location: LOC_SHAPE_RADII, format: 'float32x4', offset: 56 },
          { location: LOC_SHAPE_SRCRECT, format: 'float32x4', offset: 72 },
          { location: LOC_SHAPE_COLORFILL, format: 'unorm8x4', offset: 88 },
          { location: LOC_SHAPE_COLORSTROKE, format: 'unorm8x4', offset: 92 },
        ],
      },
    ]
  }

  async warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void> {
    this.#pipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#shader,
      vertexLayout: this.#vertexLayout,
      bindGroupLayouts: [ctx.frameBindGroupLayout, this.#materialLayout],
    })
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    // Fixed-unit textures: atlas on 0, label page on 1. Non-textured shapes
    // ignore them; a placeholder fills a slot before its texture exists.
    const atlas = ctx.textureManager.getAtlasTexture() ?? ctx.placeholderTexture
    const label =
      ctx.textureManager.getLabelPageTexture() ?? ctx.placeholderTexture
    drawInstancedRun(
      ctx,
      this.#pipelines,
      ctx.unitQuadBuffer,
      this.#stream,
      SHAPE_INSTANCE_STRIDE,
      run,
      this.#bindGroupFor(ctx, atlas, label),
    )
  }

  #bindGroupFor(
    ctx: GpuBatchContext,
    atlas: Texture,
    label: Texture,
  ): BindGroup {
    let byLabel = this.#bindGroups.get(atlas)
    if (!byLabel) {
      byLabel = new WeakMap()
      this.#bindGroups.set(atlas, byLabel)
    }
    let bg = byLabel.get(label)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.#materialLayout, [
        { binding: 0, resource: { texture: atlas } },
        { binding: 1, resource: { texture: label } },
      ])
      byLabel.set(label, bg)
    }
    return bg
  }

  #reserve(ctx: GpuBatchContext): number {
    ctx.beginBatch('shape')
    return ctx.reserveInstance(this.#stream)
  }

  // --- high-level emitters (CPU-side transform math → shape records) --------

  /** `Gfx2D.fillCircle` via the shape record (device-space center + radius). */
  fillCircle(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    r: number,
    color: string,
  ): void {
    if (r <= 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = r * Math.sqrt(det)
    this.circle(
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

  /** `Gfx2D.strokeCircle` via the shape record (dashed stroke in device px). */
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
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
    const dashInfo = resolveDash(style.dash)
    this.circle(
      ctx,
      dcx,
      dcy,
      r * scale,
      style.width * scale,
      0,
      packColor(style.color, ctx.stateStack.getAlpha()),
      dashInfo.dashStart,
      dashInfo.dashPeriod,
    )
  }

  /** `Gfx2D.fillRoundRect` via the shape record (local extents + affine). */
  fillRoundRect(
    ctx: GpuBatchContext,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: ResolvedRadii,
    color: string,
  ): void {
    if (w <= 0 || h <= 0) return
    this.#roundRectRecord(
      ctx,
      x,
      y,
      w,
      h,
      radii,
      0,
      packColor(color, ctx.stateStack.getAlpha()),
      0,
    )
  }

  /** `Gfx2D.strokeRoundRect` via the shape record. */
  strokeRoundRect(
    ctx: GpuBatchContext,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: ResolvedRadii,
    style: GfxStrokeStyle,
  ): void {
    if (w <= 0 || h <= 0 || style.width <= 0) return
    this.#roundRectRecord(
      ctx,
      x,
      y,
      w,
      h,
      radii,
      style.width,
      0,
      packColor(style.color, ctx.stateStack.getAlpha()),
    )
  }

  #roundRectRecord(
    ctx: GpuBatchContext,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: ResolvedRadii,
    strokeWidth: number,
    packedFill: number,
    packedStroke: number,
  ): void {
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const cx = x + w * 0.5
    const cy = y + h * 0.5
    const tx = t.a * cx + t.c * cy + t.e
    const ty = t.b * cx + t.d * cy + t.f
    const scaleX = Math.hypot(t.a, t.b)
    const scaleY = Math.hypot(t.c, t.d)
    const feather = 1.5 / Math.max(scaleX, scaleY, 1e-4)
    this.roundRect(
      ctx,
      t.a,
      t.b,
      t.c,
      t.d,
      tx,
      ty,
      w * 0.5,
      h * 0.5,
      feather,
      strokeWidth,
      radii,
      packedFill,
      packedStroke,
    )
  }

  /**
   * A circle (fill and/or stroke). Center + radius are in device px; the dash
   * phase repeats every `dashPeriod` px starting at `dashStart`.
   */
  circle(
    ctx: GpuBatchContext,
    dcx: number,
    dcy: number,
    radius: number,
    strokeWidth: number,
    packedFill: number,
    packedStroke: number,
    dashStart: number,
    dashPeriod: number,
  ): void {
    const off = this.#reserve(ctx)
    if (off < 0) return
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    f[off + W_TRANSLATE] = dcx
    f[off + W_TRANSLATE + 1] = dcy
    f[off + W_SHAPE] = SHAPE_KIND_CIRCLE
    f[off + W_PARAMS] = radius
    f[off + W_PARAMS + 1] = strokeWidth
    f[off + W_PARAMS + 2] = dashStart
    f[off + W_PARAMS + 3] = dashPeriod
    u[off + W_COLORFILL] = packedFill >>> 0
    u[off + W_COLORSTROKE] = packedStroke >>> 0
    this.#stream.commitInstance(ctx.curSlot)
    ctx.stats.sdfInstances++
  }

  /**
   * A rounded rect (fill and/or stroke). `affine` is the local→device columns +
   * translate; extents/feather/radii are local units.
   */
  roundRect(
    ctx: GpuBatchContext,
    ax: number,
    ay: number,
    cx2: number,
    cy2: number,
    tx: number,
    ty: number,
    halfW: number,
    halfH: number,
    feather: number,
    strokeWidth: number,
    radii: ResolvedRadii,
    packedFill: number,
    packedStroke: number,
  ): void {
    const off = this.#reserve(ctx)
    if (off < 0) return
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    f[off + W_MCOL0] = ax
    f[off + W_MCOL0 + 1] = ay
    f[off + W_MCOL1] = cx2
    f[off + W_MCOL1 + 1] = cy2
    f[off + W_TRANSLATE] = tx
    f[off + W_TRANSLATE + 1] = ty
    f[off + W_SHAPE] = SHAPE_KIND_ROUNDRECT
    f[off + W_SHAPE + 1] = feather
    f[off + W_PARAMS] = halfW
    f[off + W_PARAMS + 1] = halfH
    f[off + W_PARAMS + 2] = strokeWidth
    f[off + W_RADII] = radii[0]
    f[off + W_RADII + 1] = radii[1]
    f[off + W_RADII + 2] = radii[2]
    f[off + W_RADII + 3] = radii[3]
    u[off + W_COLORFILL] = packedFill >>> 0
    u[off + W_COLORSTROKE] = packedStroke >>> 0
    this.#stream.commitInstance(ctx.curSlot)
    ctx.stats.roundRectInstances++
  }

  /**
   * A textured quad (text or atlas sprite). `affine` columns + translate map
   * the unit square to device px; `srcRect` is the sub-rect; `texIndex` picks
   * the fixed-unit texture (`SHAPE_TEX_ATLAS` / `SHAPE_TEX_LABEL`);
   * `packedTint` is the premultiplied tint.
   */
  textured(
    ctx: GpuBatchContext,
    col0x: number,
    col0y: number,
    col1x: number,
    col1y: number,
    tx: number,
    ty: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    texIndex: number,
    packedTint: number,
  ): void {
    const off = this.#reserve(ctx)
    if (off < 0) return
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    f[off + W_MCOL0] = col0x
    f[off + W_MCOL0 + 1] = col0y
    f[off + W_MCOL1] = col1x
    f[off + W_MCOL1 + 1] = col1y
    f[off + W_TRANSLATE] = tx
    f[off + W_TRANSLATE + 1] = ty
    f[off + W_SHAPE] = SHAPE_KIND_TEXTURED
    f[off + W_SHAPE + 2] = texIndex
    f[off + W_SRCRECT] = u0
    f[off + W_SRCRECT + 1] = v0
    f[off + W_SRCRECT + 2] = u1
    f[off + W_SRCRECT + 3] = v1
    u[off + W_COLORFILL] = packedTint >>> 0
    this.#stream.commitInstance(ctx.curSlot)
  }
}

// Shape program: one instanced program covering circles,
// round-rects, and textured quads (text + atlas sprites). A per-instance
// `shapeType` picks the vertex positioning + fragment math. The atlas + label
// page bind at fixed units, so texture identity leaves the batch key and the
// common fill→text→shape interleave collapses to a single blend-only batch.
//
// This is the sole path for circles, round-rects, and page-backed text/sprites.
// A per-source image or an oversized dedicated label has its own texture, which
// this program does not bind, so `GpuGfx` routes those to the textQuad program.

import type { GfxFill, GfxShadowStyle, SolidStrokeStyle } from '../Gfx2D'
import type { ResolvedRadii } from '../roundRectRadii'
import { RingStream } from '../RingStream'
import {
  gradientAxis,
  hsvToRgb,
  packColor,
  resolveDash,
  resolvePaint,
} from '../packing'
import {
  LOC_SHAPE_COLORFILL,
  LOC_SHAPE_COLORSTROKE,
  LOC_SHAPE_MCOL0,
  LOC_SHAPE_MCOL1,
  LOC_SHAPE_MTRANSLATE,
  LOC_SHAPE_PAINT,
  LOC_SHAPE_PARAMS,
  LOC_SHAPE_RADII,
  LOC_SHAPE_KIND,
  LOC_SHAPE_SRCRECT,
  LOC_SHAPE_UNIT,
  SHAPE_BUFFER_BYTES,
  SHAPE_INSTANCE_STRIDE,
  SHAPE_KIND_CIRCLE,
  SHAPE_KIND_ROUNDRECT,
  SHAPE_KIND_SHADOW,
  SHAPE_KIND_TEXTURED,
  SHAPE_PARAMS_UBO_BINDING,
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
import { unitQuadLayout, UboRing, warmupBlendPipelines } from './programCommon'
import type { ShaderReflection } from '../GfxDevice'
import type { TransformOut } from '../TransformStack'
import shapeWgsl from '../shaders/shape.wgsl?raw'
import shapeVertSrc from '../shaders/shape.gen.vert.glsl?raw'
import shapeFragSrc from '../shaders/shape.gen.frag.glsl?raw'
import shapeReflect from '../shaders/shape.reflect.json'

/** `ShapeParams` block size (std140): debugColor + flags, two vec4s = 32 B. */
const SHAPE_PARAMS_BYTES = 32

/** Word offsets into the 28-word shape instance record. */
const W_MCOL0 = 0
const W_MCOL1 = 2
const W_TRANSLATE = 4
const W_SHAPE = 6 // (shapeType, feather, texIndex, pad)
const W_PARAMS = 10
const W_RADII = 14
const W_SRCRECT = 18
const W_COLORFILL = 22
const W_COLORSTROKE = 23
const W_PAINT = 24 // fill gradient: (scaleDirX, scaleDirY, startOffset, rampRow + 1)

/**
 * `style.align` resolved to a signed `strokeOffset` (0 center, `-width/2`
 * inside, `+width/2` outside), clamped so an inside stroke wider than the
 * box can't push past its center and invert the band.
 */
function strokeOffsetFor(
  style: SolidStrokeStyle,
  w: number,
  h: number,
): number {
  const maxOffset = Math.max(0, Math.min(w, h) * 0.5 - 1e-3)
  const raw =
    style.align === 'inside'
      ? -style.width * 0.5
      : style.align === 'outside'
        ? style.width * 0.5
        : 0
  return Math.max(-maxOffset, Math.min(maxOffset, raw))
}

export class ShapeProgram implements GpuProgram {
  readonly kind = 'shape' as const

  #shader!: ShaderModule
  #stream!: RingStream
  #pipelines: Map<string, Pipeline> = new Map()
  #vertexLayout: VertexBufferLayout[] = []
  #materialLayout!: BindGroupLayout
  /** (atlas → (label → (ramp atlas → bind group))), the fixed textures this program binds. */
  #bindGroups = new WeakMap<
    Texture,
    WeakMap<Texture, WeakMap<Texture, BindGroup>>
  >()
  /** Per-run debug-mode override (dynamic-offset ring), see `ShapeParams` in shape.wgsl. */
  #paramsRing!: UboRing
  readonly #paramsStaging = new Float32Array(SHAPE_PARAMS_BYTES / 4)
  /** `flags` is a `vec4<u32>`; same dual-view trick as `RingStream`/`coloredTri`. */
  readonly #paramsStagingU32 = new Uint32Array(this.#paramsStaging.buffer)

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
      { binding: 2, type: 'texture-2d' },
      {
        binding: SHAPE_PARAMS_UBO_BINDING,
        type: 'uniform-buffer',
        dynamicOffset: true,
      },
    ])
    this.#paramsRing = new UboRing(
      device,
      SHAPE_PARAMS_BYTES,
      2048,
      'shapeParams',
    )
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
          { location: LOC_SHAPE_PAINT, format: 'float32x4', offset: 96 },
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

  resetFrame(): void {
    this.#paramsRing.reset()
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    const words = SHAPE_INSTANCE_STRIDE / 4
    const instCount = (run.endWord - run.startWord) / words
    if (instCount === 0) return

    // Fixed-unit textures: atlas on 0, label page on 1, ramp atlas on 2.
    // Non-textured shapes ignore the first two; a shape with no gradient
    // ignores the third. A placeholder fills a slot before its texture
    // exists.
    const atlas = ctx.textureManager.getAtlasTexture() ?? ctx.placeholderTexture
    const label =
      ctx.textureManager.getLabelPageTexture() ?? ctx.placeholderTexture
    const ramp =
      ctx.textureManager.getRampAtlasTexture() ?? ctx.placeholderTexture

    const debugModeInt =
      run.debugMode === 'overdraw' ? 1 : run.debugMode === 'batch-color' ? 2 : 0
    const s = this.#paramsStaging
    const su = this.#paramsStagingU32
    if (debugModeInt === 2) {
      // Golden-ratio hue cycling, same as `coloredTri`'s batch-color mode, so
      // the two programs' hues read consistently in one frame's HUD overlay.
      const h = ((run.debugBatchIndex * 0.61803398875) % 1) * 6
      const [r, g, b] = hsvToRgb(h, 0.75, 1)
      s[0] = r * 0.8
      s[1] = g * 0.8
      s[2] = b * 0.8
      s[3] = 0.8
    } else {
      s[0] = s[1] = s[2] = s[3] = 0
    }
    su[4] = debugModeInt
    su[5] = 0
    su[6] = 0
    su[7] = 0
    const dynOffset = this.#paramsRing.push(ctx.device, s)
    if (dynOffset < 0) return

    // Overdraw forces additive blend so the constant red accumulates as a
    // heatmap instead of painting opaque, same as `coloredTri`.
    const blend = debugModeInt === 1 ? 'lighter' : run.blend
    const pipeline = this.#pipelines.get(blend)
    if (!pipeline) return

    ctx.device.draw({
      pipeline,
      vertexBuffers: [
        { buffer: ctx.unitQuadBuffer, offset: 0 },
        { buffer: this.#stream.buffers[ctx.curSlot], offset: run.startWord * 4 },
      ],
      bindGroups: [
        ctx.frameBindGroupEntry(ctx.clipOffsetForRun(run)),
        {
          group: 1,
          bindGroup: this.#bindGroupFor(ctx, atlas, label, ramp),
          dynamicOffsets: [dynOffset],
        },
      ],
      vertexCount: 6,
      instanceCount: instCount,
    })
    ctx.stats.drawCalls++
  }

  #bindGroupFor(
    ctx: GpuBatchContext,
    atlas: Texture,
    label: Texture,
    ramp: Texture,
  ): BindGroup {
    let byLabel = this.#bindGroups.get(atlas)
    if (!byLabel) {
      byLabel = new WeakMap()
      this.#bindGroups.set(atlas, byLabel)
    }
    let byRamp = byLabel.get(label)
    if (!byRamp) {
      byRamp = new WeakMap()
      byLabel.set(label, byRamp)
    }
    let bg = byRamp.get(ramp)
    if (!bg) {
      bg = ctx.device.createBindGroup(this.#materialLayout, [
        { binding: 0, resource: { texture: atlas } },
        { binding: 1, resource: { texture: label } },
        { binding: 2, resource: { texture: ramp } },
        {
          binding: SHAPE_PARAMS_UBO_BINDING,
          resource: {
            uniformBuffer: this.#paramsRing.buffer,
            size: SHAPE_PARAMS_BYTES,
          },
        },
      ])
      byRamp.set(ramp, bg)
    }
    return bg
  }

  #reserve(ctx: GpuBatchContext): number {
    ctx.beginBatch('shape')
    return ctx.reserveInstance(this.#stream)
  }

  /**
   * Resolve `fill` against the already-read current transform `t`: a packed
   * fill color plus the four `a_paint` words (zero when solid, so a
   * §2.2-zeroed record reads as "no gradient"). `null` only when a gradient
   * needs a ramp row and the atlas cannot give it (headless, no 2D context);
   * the caller should then skip the draw rather than fill with garbage.
   */
  #resolveFillPaint(
    ctx: GpuBatchContext,
    fill: GfxFill,
    t: TransformOut,
  ): { packedFill: number; paint: [number, number, number, number] } | null {
    const alpha = ctx.stateStack.getAlpha()
    const resolved = resolvePaint(fill, alpha)
    if (resolved.kind === 'solid') {
      return { packedFill: resolved.packedColor, paint: [0, 0, 0, 0] }
    }
    const g = resolved.paint
    const rampRow = ctx.textureManager.ensureStopsRow(g.stops, () =>
      ctx.forceMidFrameSubmit(),
    )
    if (rampRow < 0) return null
    const dx0 = t.a * g.x0 + t.c * g.y0 + t.e
    const dy0 = t.b * g.x0 + t.d * g.y0 + t.f
    const dx1 = t.a * g.x1 + t.c * g.y1 + t.e
    const dy1 = t.b * g.x1 + t.d * g.y1 + t.f
    const axis = gradientAxis(dx0, dy0, dx1, dy1)
    // Alpha-only: rgb is unused in gradient mode (the fragment samples the
    // ramp instead), so the draw's own alpha rides in this channel rather
    // than needing a separate per-instance opacity field.
    const packedFill =
      (Math.max(0, Math.min(255, Math.round(alpha * 255))) << 24) >>> 0
    return {
      packedFill,
      paint: [axis.scaleDirX, axis.scaleDirY, axis.startOffset, rampRow + 1],
    }
  }

  // --- high-level emitters (CPU-side transform math → shape records) --------

  /** `Gfx2D.fillCircle` via the shape record (device-space center + radius). */
  fillCircle(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    r: number,
    fill: GfxFill,
  ): void {
    if (r <= 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const resolved = this.#resolveFillPaint(ctx, fill, t)
    if (!resolved) return
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
      resolved.packedFill,
      0,
      0,
      0,
      resolved.paint,
    )
  }

  /** `Gfx2D.strokeCircle` via the shape record (dashed stroke in device px). */
  strokeCircle(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    r: number,
    style: SolidStrokeStyle,
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

  /**
   * `fillCircle` + `strokeCircle` in one record, for a node that sets both:
   * see `fillAndStrokeRoundRect`'s doc for why that matters for a
   * translucent stroke.
   */
  fillAndStrokeCircle(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    r: number,
    fill: GfxFill,
    style: SolidStrokeStyle,
  ): void {
    if (r <= 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const resolved = this.#resolveFillPaint(ctx, fill, t)
    if (!resolved) return
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c))
    const strokeWidth = style.width > 0 ? style.width * scale : 0
    const dashInfo = strokeWidth > 0 ? resolveDash(style.dash) : null
    this.circle(
      ctx,
      dcx,
      dcy,
      r * scale,
      strokeWidth,
      resolved.packedFill,
      strokeWidth > 0 ? packColor(style.color, ctx.stateStack.getAlpha()) : 0,
      dashInfo?.dashStart ?? 0,
      dashInfo?.dashPeriod ?? 0,
      resolved.paint,
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
    fill: GfxFill,
  ): void {
    if (w <= 0 || h <= 0) return
    this.#roundRectRecord(ctx, x, y, w, h, radii, 0, 0, fill, 0)
  }

  /**
   * `Gfx2D.strokeRoundRect` via the shape record. `style.align` becomes a
   * per-instance `strokeOffset` (0 center, `-width/2` inside, `+width/2`
   * outside), clamped so an inside stroke wider than the box can't invert
   * the band.
   */
  strokeRoundRect(
    ctx: GpuBatchContext,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: ResolvedRadii,
    style: SolidStrokeStyle,
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
      strokeOffsetFor(style, w, h),
      null,
      packColor(style.color, ctx.stateStack.getAlpha()),
    )
  }

  /**
   * `fillRoundRect` + `strokeRoundRect` in one record, for a node that sets
   * both: the shader composites fill under stroke in one fragment only when
   * they share an instance, otherwise a translucent stroke's own AA ramp
   * double-blends against the separately-drawn fill underneath it.
   */
  fillAndStrokeRoundRect(
    ctx: GpuBatchContext,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: ResolvedRadii,
    fill: GfxFill,
    style: SolidStrokeStyle,
  ): void {
    if (w <= 0 || h <= 0) return
    const strokeWidth = style.width > 0 ? style.width : 0
    this.#roundRectRecord(
      ctx,
      x,
      y,
      w,
      h,
      radii,
      strokeWidth,
      strokeWidth > 0 ? strokeOffsetFor(style, w, h) : 0,
      fill,
      strokeWidth > 0 ? packColor(style.color, ctx.stateStack.getAlpha()) : 0,
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
    strokeOffset: number,
    fill: GfxFill | null,
    packedStroke: number,
  ): void {
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    let packedFill = 0
    let paint: [number, number, number, number] = [0, 0, 0, 0]
    if (fill !== null) {
      const resolved = this.#resolveFillPaint(ctx, fill, t)
      if (!resolved) return
      packedFill = resolved.packedFill
      paint = resolved.paint
    }
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
      strokeOffset,
      radii,
      packedFill,
      packedStroke,
      paint,
    )
  }

  /**
   * A circle (fill and/or stroke). Center + radius are in device px. The dash
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
    paint: readonly [number, number, number, number] = [0, 0, 0, 0],
  ): void {
    const off = this.#reserve(ctx)
    if (off < 0) return
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    // Every word of the record is written, including the ones this kind does
    // not use. `RingStream` never clears a slice between frames, so a word
    // left stale here is a previous frame's data for a kind that reads it.
    f[off + W_MCOL0] = 0
    f[off + W_MCOL0 + 1] = 0
    f[off + W_MCOL1] = 0
    f[off + W_MCOL1 + 1] = 0
    f[off + W_TRANSLATE] = dcx
    f[off + W_TRANSLATE + 1] = dcy
    f[off + W_SHAPE] = SHAPE_KIND_CIRCLE
    f[off + W_SHAPE + 1] = 0
    f[off + W_SHAPE + 2] = 0
    f[off + W_SHAPE + 3] = 0
    f[off + W_PARAMS] = radius
    f[off + W_PARAMS + 1] = strokeWidth
    f[off + W_PARAMS + 2] = dashStart
    f[off + W_PARAMS + 3] = dashPeriod
    f[off + W_RADII] = 0
    f[off + W_RADII + 1] = 0
    f[off + W_RADII + 2] = 0
    f[off + W_RADII + 3] = 0
    f[off + W_SRCRECT] = 0
    f[off + W_SRCRECT + 1] = 0
    f[off + W_SRCRECT + 2] = 0
    f[off + W_SRCRECT + 3] = 0
    u[off + W_COLORFILL] = packedFill >>> 0
    u[off + W_COLORSTROKE] = packedStroke >>> 0
    f[off + W_PAINT] = paint[0]
    f[off + W_PAINT + 1] = paint[1]
    f[off + W_PAINT + 2] = paint[2]
    f[off + W_PAINT + 3] = paint[3]
    this.#stream.commitInstance(ctx.curSlot)
    ctx.stats.sdfInstances++
  }

  /**
   * A rounded rect (fill and/or stroke). `affine` is the local→device columns +
   * translate, and extents/feather/radii are local units.
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
    strokeOffset: number,
    radii: ResolvedRadii,
    packedFill: number,
    packedStroke: number,
    paint: readonly [number, number, number, number] = [0, 0, 0, 0],
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
    f[off + W_SHAPE + 2] = 0
    f[off + W_SHAPE + 3] = 0
    f[off + W_PARAMS] = halfW
    f[off + W_PARAMS + 1] = halfH
    f[off + W_PARAMS + 2] = strokeWidth
    f[off + W_PARAMS + 3] = strokeOffset
    f[off + W_RADII] = radii[0]
    f[off + W_RADII + 1] = radii[1]
    f[off + W_RADII + 2] = radii[2]
    f[off + W_RADII + 3] = radii[3]
    f[off + W_SRCRECT] = 0
    f[off + W_SRCRECT + 1] = 0
    f[off + W_SRCRECT + 2] = 0
    f[off + W_SRCRECT + 3] = 0
    u[off + W_COLORFILL] = packedFill >>> 0
    u[off + W_COLORSTROKE] = packedStroke >>> 0
    f[off + W_PAINT] = paint[0]
    f[off + W_PAINT + 1] = paint[1]
    f[off + W_PAINT + 2] = paint[2]
    f[off + W_PAINT + 3] = paint[3]
    this.#stream.commitInstance(ctx.curSlot)
    ctx.stats.roundRectInstances++
  }

  /**
   * A textured quad (text or atlas sprite). `affine` columns + translate map
   * the unit square to device px. `srcRect` is the sub-rect, `texIndex` picks
   * the fixed-unit texture (`SHAPE_TEX_ATLAS` / `SHAPE_TEX_LABEL`), and
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
    // The fragment stage's gradient sample reads a_paint unconditionally
    // (same reason the atlas/label textures are sampled unconditionally:
    // shapeType is a per-instance varying, not uniform control flow), even
    // though a textured instance's output never factors it in. Zero it per
    // the §2.2 discipline rather than relying on that being true forever.
    f[off + W_PAINT] = 0
    f[off + W_PAINT + 1] = 0
    f[off + W_PAINT + 2] = 0
    f[off + W_PAINT + 3] = 0
    this.#stream.commitInstance(ctx.curSlot)
  }

  /**
   * A drop shadow for a rounded rect's (or, via uniform radii, a circle's)
   * border box. `affine` is the local→device columns + translate (same as
   * `roundRect`), `halfW`/`halfH`/`radii` describe the TRUE border box (for
   * the outset knockout / inset guard), and `sigma`/`spread`/`offsetX`/
   * `offsetY` are already in the same local units, pre-converted by the
   * caller.
   */
  shadow(
    ctx: GpuBatchContext,
    ax: number,
    ay: number,
    cx2: number,
    cy2: number,
    tx: number,
    ty: number,
    halfW: number,
    halfH: number,
    radii: ResolvedRadii,
    sigma: number,
    spread: number,
    offsetX: number,
    offsetY: number,
    inset: boolean,
    packedColor: number,
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
    f[off + W_SHAPE] = SHAPE_KIND_SHADOW
    f[off + W_SHAPE + 1] = 0
    f[off + W_SHAPE + 2] = 0
    f[off + W_SHAPE + 3] = inset ? 1 : 0
    f[off + W_PARAMS] = halfW
    f[off + W_PARAMS + 1] = halfH
    f[off + W_PARAMS + 2] = 0
    f[off + W_PARAMS + 3] = 0 // strokeOffset: always center until a node exposes border alignment
    f[off + W_RADII] = radii[0]
    f[off + W_RADII + 1] = radii[1]
    f[off + W_RADII + 2] = radii[2]
    f[off + W_RADII + 3] = radii[3]
    f[off + W_SRCRECT] = sigma
    f[off + W_SRCRECT + 1] = spread
    f[off + W_SRCRECT + 2] = offsetX
    f[off + W_SRCRECT + 3] = offsetY
    u[off + W_COLORFILL] = packedColor >>> 0
    u[off + W_COLORSTROKE] = 0
    f[off + W_PAINT] = 0
    f[off + W_PAINT + 1] = 0
    f[off + W_PAINT + 2] = 0
    f[off + W_PAINT + 3] = 0
    this.#stream.commitInstance(ctx.curSlot)
    ctx.stats.shadowInstances++
  }

  /**
   * Resolve a `GfxShadowStyle` + the shape's own border box into the device
   * ingredients `shadow` needs, converting back to local units (the shadow
   * geometry, like round-rect, is evaluated in local space via the affine).
   * `halfW`/`halfH` are local; everything on `style` already follows
   * `strokeSpace` (same convention as `GfxStrokeStyle.width`), hence device
   * px, which is why the sigma clamp (deliberately a CSS deviation: past it
   * the integral cannot resolve the shape) happens before the conversion
   * back.
   */
  #resolveShadow(
    t: TransformOut,
    halfW: number,
    halfH: number,
    style: GfxShadowStyle,
  ): {
    sigma: number
    spread: number
    offsetX: number
    offsetY: number
  } {
    const scaleX = Math.hypot(t.a, t.b)
    const scaleY = Math.hypot(t.c, t.d)
    const scale = Math.sqrt(Math.abs(t.a * t.d - t.b * t.c)) || 1e-4
    const sigmaDeviceRaw = (style.blur ?? 0) / 2
    const sigmaMaxDevice =
      2 * Math.max(0, Math.min(halfW * scaleX, halfH * scaleY))
    const sigmaDevice = Math.min(sigmaDeviceRaw, sigmaMaxDevice)
    return {
      sigma: sigmaDevice / scale,
      spread: (style.spread ?? 0) / scale,
      offsetX: (style.offsetX ?? 0) / Math.max(scaleX, 1e-4),
      offsetY: (style.offsetY ?? 0) / Math.max(scaleY, 1e-4),
    }
  }

  /** `Gfx2D`-level primitive behind `ShapeNode`'s rounded-rect/box shadow. */
  shadowRoundRect(
    ctx: GpuBatchContext,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: ResolvedRadii,
    style: GfxShadowStyle,
  ): void {
    if (w <= 0 || h <= 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const halfW = w * 0.5
    const halfH = h * 0.5
    const resolved = this.#resolveShadow(t, halfW, halfH, style)
    const cx = x + halfW
    const cy = y + halfH
    const tx = t.a * cx + t.c * cy + t.e
    const ty = t.b * cx + t.d * cy + t.f
    const alpha = ctx.stateStack.getAlpha()
    this.shadow(
      ctx,
      t.a,
      t.b,
      t.c,
      t.d,
      tx,
      ty,
      halfW,
      halfH,
      radii,
      resolved.sigma,
      resolved.spread,
      resolved.offsetX,
      resolved.offsetY,
      style.inset === true,
      packColor(style.color, alpha),
    )
  }

  /** `Gfx2D`-level primitive behind `ShapeNode`'s circle shadow. */
  shadowCircle(
    ctx: GpuBatchContext,
    cx: number,
    cy: number,
    r: number,
    style: GfxShadowStyle,
  ): void {
    if (r <= 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const resolved = this.#resolveShadow(t, r, r, style)
    const tx = t.a * cx + t.c * cy + t.e
    const ty = t.b * cx + t.d * cy + t.f
    const alpha = ctx.stateStack.getAlpha()
    this.shadow(
      ctx,
      t.a,
      t.b,
      t.c,
      t.d,
      tx,
      ty,
      r,
      r,
      [r, r, r, r],
      resolved.sigma,
      resolved.spread,
      resolved.offsetX,
      resolved.offsetY,
      style.inset === true,
      packColor(style.color, alpha),
    )
  }
}

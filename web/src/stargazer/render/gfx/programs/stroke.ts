// Stroke program: lines, quadratics, and polylines. No texture; the batch key
// is blend-only. Owns curve flattening (`smoothToBuffer`, the quadratic
// flatten scratch) since every stroke shape funnels through the polyline
// emitter.

import type { GfxDevice, Pipeline, VertexBufferLayout } from '../GfxDevice'
import type { GfxStrokeStyle } from '../Gfx2D'
import { flattenQuadratic } from '../../../assets/SvgPathContours'
import { RingStream } from '../RingStream'
import { packColor, resolveDash } from '../packing'
import {
  CURVE_FLATTEN_MAX_POINTS,
  CURVE_FLATTEN_TOL_PX,
  LOC_STROKE_COLOR,
  LOC_STROKE_P0,
  LOC_STROKE_P1,
  LOC_STROKE_UNIT,
  LOC_STROKE_WIDTHDASH,
  STROKE_BUFFER_BYTES,
  STROKE_INSTANCE_STRIDE,
} from '../batchLayout'
import type { DrawRun, GpuBatchContext } from '../GpuBatchContext'
import type { GpuProgram } from '../GpuProgram'
import { drawInstancedRun, unitQuadLayout, warmupBlendPipelines } from './programCommon'
import type { ShaderReflection } from '../GfxDevice'
import strokeWgsl from '../shaders/stroke.wgsl?raw'
import strokeVertSrc from '../shaders/stroke.gen.vert.glsl?raw'
import strokeFragSrc from '../shaders/stroke.gen.frag.glsl?raw'
import strokeReflect from '../shaders/stroke.reflect.json'

export class StrokeProgram implements GpuProgram {
  readonly kind = 'stroke' as const

  #shader!: import('../GfxDevice').ShaderModule
  #stream!: RingStream
  #pipelines: Map<string, Pipeline> = new Map()
  #vertexLayout: VertexBufferLayout[] = []

  get stream(): RingStream {
    return this.#stream
  }

  /** Curve flattening scratch. Reused across calls since strokes don't nest. */
  readonly #flattenScratch = new Float32Array(CURVE_FLATTEN_MAX_POINTS * 2)

  init(device: GfxDevice, _ctx: GpuBatchContext): void {
    this.#shader = device.createShaderModule({
      glsl: { vertex: strokeVertSrc, fragment: strokeFragSrc },
      wgsl: {
        code: strokeWgsl,
        vertexEntry: 'vs_main',
        fragmentEntry: 'fs_main',
      },
      reflection: strokeReflect as ShaderReflection,
      label: 'stroke',
    })
    this.#stream = new RingStream(
      device,
      STROKE_BUFFER_BYTES,
      STROKE_INSTANCE_STRIDE,
      'stroke',
    )
    this.#vertexLayout = [
      unitQuadLayout(LOC_STROKE_UNIT),
      {
        arrayStride: STROKE_INSTANCE_STRIDE,
        stepMode: 'instance',
        attributes: [
          { location: LOC_STROKE_P0, format: 'float32x2', offset: 0 },
          { location: LOC_STROKE_P1, format: 'float32x2', offset: 8 },
          { location: LOC_STROKE_COLOR, format: 'unorm8x4', offset: 16 },
          { location: LOC_STROKE_WIDTHDASH, format: 'float32x4', offset: 20 },
        ],
      },
    ]
  }

  async warmup(device: GfxDevice, ctx: GpuBatchContext): Promise<void> {
    this.#pipelines = await warmupBlendPipelines(device, ctx, {
      shader: this.#shader,
      vertexLayout: this.#vertexLayout,
      bindGroupLayouts: [ctx.frameBindGroupLayout],
    })
  }

  drawRun(ctx: GpuBatchContext, run: DrawRun): void {
    drawInstancedRun(
      ctx,
      this.#pipelines,
      ctx.unitQuadBuffer,
      this.#stream,
      STROKE_INSTANCE_STRIDE,
      run,
      null,
    )
  }

  /** `Gfx2D.strokeLine`. */
  line(
    ctx: GpuBatchContext,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (style.width <= 0) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const dp0x = t.a * x0 + t.c * y0 + t.e
    const dp0y = t.b * x0 + t.d * y0 + t.f
    const dp1x = t.a * x1 + t.c * y1 + t.e
    const dp1y = t.b * x1 + t.d * y1 + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = Math.sqrt(det)
    const dw = style.width * scale
    const dashInfo = resolveDash(style.dash, scale)
    const packedColor = packColor(style.color, ctx.stateStack.getAlpha())
    this.#emitInstance(
      ctx,
      dp0x,
      dp0y,
      dp1x,
      dp1y,
      packedColor,
      dw,
      dashInfo.dashStart,
      dashInfo.dashPeriod,
      dashInfo.dashOnLen,
    )
  }

  /** `Gfx2D.strokeQuadratic`. Flattens in local space, then reuses `polyline`. */
  quadratic(
    ctx: GpuBatchContext,
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    if (style.width <= 0) return
    // Local tolerance: pixel tolerance divided by current transform scale.
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const localTol = CURVE_FLATTEN_TOL_PX / (Math.sqrt(det) || 1)
    const buf = this.#flattenScratch
    // Seed with start point.
    buf[0] = x0
    buf[1] = y0
    let cursor = 2
    cursor = flattenQuadratic(x0, y0, cx, cy, x1, y1, localTol, buf, cursor)
    const count = cursor / 2
    this.polyline(ctx, buf, count, style)
  }

  /** `Gfx2D.strokePolyline`. */
  polyline(
    ctx: GpuBatchContext,
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2 || style.width <= 0) return
    // Optional midpoint-quadratic smoothing.
    if (style.smoothing === 'quadratic' && count >= 3) {
      const smoothed = this.#smoothToBuffer(ctx, pts, count)
      this.#emitPolylineInstances(ctx, smoothed.buf, smoothed.count, style)
      return
    }
    this.#emitPolylineInstances(ctx, pts, count, style)
  }

  /**
   * Midpoint-Bézier smoothing (`GfxStrokeStyle.smoothing: 'quadratic'`): a
   * segment to the midpoint, then a quadratic curve per interior point using
   * the midpoint of successive points as the anchor. Flattens to line segments
   * in the scratch buffer + returns the point count.
   */
  #smoothToBuffer(
    ctx: GpuBatchContext,
    pts: ArrayLike<number>,
    count: number,
  ): { buf: Float32Array; count: number } {
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const localTol = CURVE_FLATTEN_TOL_PX / (Math.sqrt(det) || 1)
    const buf = this.#flattenScratch
    let cursor = 0
    // First point.
    buf[cursor++] = pts[0]
    buf[cursor++] = pts[1]
    // Midpoint of first segment.
    const m0x = (pts[0] + pts[2]) * 0.5
    const m0y = (pts[1] + pts[3]) * 0.5
    buf[cursor++] = m0x
    buf[cursor++] = m0y
    // Interior quadratics.
    let curX = m0x
    let curY = m0y
    for (let i = 1; i < count - 1; i++) {
      const ctrlX = pts[i * 2]
      const ctrlY = pts[i * 2 + 1]
      const nextX = pts[(i + 1) * 2]
      const nextY = pts[(i + 1) * 2 + 1]
      const anchorX = (ctrlX + nextX) * 0.5
      const anchorY = (ctrlY + nextY) * 0.5
      cursor = flattenQuadratic(
        curX,
        curY,
        ctrlX,
        ctrlY,
        anchorX,
        anchorY,
        localTol,
        buf,
        cursor,
      )
      curX = anchorX
      curY = anchorY
    }
    // Terminal line to last input point.
    if (cursor + 2 <= buf.length) {
      buf[cursor++] = pts[(count - 1) * 2]
      buf[cursor++] = pts[(count - 1) * 2 + 1]
    }
    return { buf, count: cursor / 2 }
  }

  /**
   * Common polyline emitter: transforms local points to device px, emits N-1
   * stroke segments with dashStart accumulating across the polyline, plus join
   * discs at interior vertices under `source-over` (skipped under `lighter` to
   * avoid brightening).
   */
  #emitPolylineInstances(
    ctx: GpuBatchContext,
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2) return
    ctx.txStack.read(ctx.txOut)
    const t = ctx.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = Math.sqrt(det)
    const dw = style.width * scale
    const dashInfo = resolveDash(style.dash, scale)
    const packedColor = packColor(style.color, ctx.stateStack.getAlpha())
    const closed = style.closed === true
    // Join discs cover the gap outside a mitre for round/bevel joins. Each
    // disc has an SDF-AA edge, so at shared vertices (state tripoints,
    // coastline-over-state) they stack under source-over into visible halo
    // dots. Miter (the default) skips them, segment quads cover the join at
    // gentle-angle joints like state borders. Lighter blend also skips to
    // avoid double-brightening.
    const emitJoins = (style.join ?? 'miter') !== 'miter'
    const doJoins = ctx.stateStack.getBlend() !== 'lighter' && emitJoins

    let prevDx = t.a * pts[0] + t.c * pts[1] + t.e
    let prevDy = t.b * pts[0] + t.d * pts[1] + t.f
    let dashStart = 0
    const segTotal = closed ? count : count - 1
    for (let i = 1; i <= segTotal; i++) {
      const j = i === count ? 0 : i
      const curLx = pts[j * 2]
      const curLy = pts[j * 2 + 1]
      const curDx = t.a * curLx + t.c * curLy + t.e
      const curDy = t.b * curLx + t.d * curLy + t.f
      this.#emitInstance(
        ctx,
        prevDx,
        prevDy,
        curDx,
        curDy,
        packedColor,
        dw,
        dashStart,
        dashInfo.dashPeriod,
        dashInfo.dashOnLen,
      )
      // Join disc at the interior vertex we just arrived at (skip on final
      // vertex of open polyline; do emit on closed's last vertex).
      const isInterior = closed || i < segTotal
      if (doJoins && isInterior) {
        this.#emitInstance(
          ctx,
          curDx,
          curDy,
          curDx,
          curDy,
          packedColor,
          dw,
          0,
          0,
          0,
        )
      }
      // Advance dash phase along this segment length.
      const sx = curDx - prevDx
      const sy = curDy - prevDy
      dashStart += Math.sqrt(sx * sx + sy * sy)
      prevDx = curDx
      prevDy = curDy
    }
  }

  #emitInstance(
    ctx: GpuBatchContext,
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    packedColor: number,
    width: number,
    dashStart: number,
    dashPeriod: number,
    dashOnLen: number,
  ): void {
    ctx.beginBatch('stroke')
    const off = ctx.reserveInstance(this.#stream)
    if (off < 0) return
    const slot = ctx.curSlot
    const f = this.#stream.floatView
    const u = this.#stream.uintView
    f[off + 0] = p0x
    f[off + 1] = p0y
    f[off + 2] = p1x
    f[off + 3] = p1y
    u[off + 4] = packedColor >>> 0
    f[off + 5] = width
    f[off + 6] = dashStart
    f[off + 7] = dashPeriod
    f[off + 8] = dashOnLen
    this.#stream.commitInstance(slot)
    ctx.stats.strokeInstances++
  }
}

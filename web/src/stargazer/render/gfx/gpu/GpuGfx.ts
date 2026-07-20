/**
 * `Gfx2D` implementation that batches draws through a `GfxDevice`.
 *
 * Flush conditions: program change, texture bind, blend mode, ring-slot
 * overflow, explicit `flush()` at a layer boundary, `endFrame`. Alpha, color,
 * and transform changes fold into per-vertex data and never flush.
 *
 * Coordinator: this class holds the `Gfx2D` public surface and the frame
 * lifecycle. Each draw program (coloredTri, texturedQuad, stroke, sdf,
 * gradientRadial, maskedGradient, textQuad) lives in `./programs/*.ts` and owns
 * its shader, VAO, ring-buffered stream, and flush. Shared batch state
 * (transform/state stacks, the active-batch key, the texture manager) lives on
 * `GpuBatchContext`, so a program module never needs a `GpuGfx` reference.
 */

import type {
  Gfx2D,
  GfxGradientStop,
  GfxStrokeStyle,
  GfxTextStyle,
} from '../Gfx2D'
import type { RenderTarget, Texture, VBuffer } from '../GfxDevice'
import type { GfxDevice } from '../GfxDevice'
import { parseColor } from '../parseColor'
import type { GeometryHandle } from '../GeometryHandle'
import {
  getContourClosed,
  getPathContours,
  getPathTessellation,
  registerPathTessellation,
} from '../PathTessellationRegistry'
import { TextureManager, type TextureInspector } from './TextureManager'
import { DEFAULT_LABEL_FONT, type LabelStyle } from '../rasterizeLabel'
import type { BitmapMask } from '../../../assets/BitmapMask'
import { rgbaTuple } from './packing'
import { RING_SIZE } from './batchLayout'
import {
  GpuBatchContext,
  type DebugRenderMode,
  type GpuGfxStats,
} from './GpuBatchContext'
import { ColoredTriProgram } from './programs/coloredTri'
import { TexturedQuadProgram } from './programs/texturedQuad'
import { StrokeProgram } from './programs/stroke'
import { SdfProgram } from './programs/sdf'
import { GradientRadialProgram } from './programs/gradientRadial'
import { MaskedGradientProgram } from './programs/maskedGradient'
import { TextQuadProgram } from './programs/textQuad'

export type { DebugRenderMode, GpuGfxStats }

/**
 * Counters for `Gfx2D` calls that hit a no-op path (e.g. `strokePath2D` on a
 * Path2D without a registered tessellation). Surfaced in the HUD.
 */
export interface UnimplementedCounts {
  fillCircle: number
  fillConvexPoly: number
  fillPath2D: number
  fillCircleRadialGradient: number
  fillPolyLinearGradient: number
  strokeCircle: number
  strokeLine: number
  strokeQuadratic: number
  strokePolyline: number
  strokePath2D: number
  drawImageWithRotation: number
}

export class GpuGfx implements Gfx2D {
  readonly #device: GfxDevice
  readonly #canvas: HTMLCanvasElement

  // FBO target.
  #target: RenderTarget
  #targetWidth: number
  #targetHeight: number

  /**
   * Shared batch state: transform/state stacks, active-batch key, texture
   * manager.
   */
  readonly #ctx: GpuBatchContext

  readonly #coloredTri = new ColoredTriProgram()
  readonly #texturedQuad = new TexturedQuadProgram()
  readonly #stroke = new StrokeProgram()
  readonly #sdf = new SdfProgram()
  readonly #gradientRadial = new GradientRadialProgram()
  readonly #maskedGradient = new MaskedGradientProgram()
  readonly #textQuad = new TextQuadProgram()

  /**
   * Every texture the GPU backend uses: atlas, per-source, gradient LUTs, clip
   * masks. Mirrored onto `ctx.textureManager` so program modules can reach it.
   */
  #textureManager!: TextureManager

  /** Warn-once state for the unsupported "rotation + drawImage" case. */
  #warnedRotatedImage = false

  readonly stats: GpuGfxStats = {
    drawCalls: 0,
    programSwitches: 0,
    textureBinds: 0,
    blendSwitches: 0,
    overflowWarns: 0,
    sdfInstances: 0,
    strokeInstances: 0,
    msaaSamples: 1,
  }
  /** Tripwire counters. Ticked when a Gfx2D call reaches a no-op path. */
  readonly unimplemented: UnimplementedCounts = {
    fillCircle: 0,
    fillConvexPoly: 0,
    fillPath2D: 0,
    fillCircleRadialGradient: 0,
    fillPolyLinearGradient: 0,
    strokeCircle: 0,
    strokeLine: 0,
    strokeQuadratic: 0,
    strokePolyline: 0,
    strokePath2D: 0,
    drawImageWithRotation: 0,
  }

  /**
   * MSAA sample count. `1` = plain color texture. `>1` = multisample
   * renderbuffer resolved by `blitToDefault`. Persists across resize and
   * context restore.
   */
  #samples: number

  constructor(
    canvas: HTMLCanvasElement,
    device: GfxDevice,
    opts: { samples?: number } = {},
  ) {
    this.#canvas = canvas
    this.#device = device
    this.#samples = opts.samples ?? 4
    this.#targetWidth = canvas.width || 1
    this.#targetHeight = canvas.height || 1
    this.#target = null as unknown as RenderTarget
    this.#textureManager = null as unknown as TextureManager
    this.#ctx = new GpuBatchContext(device, this.stats)
    this.#ctx.registerProgram(this.#coloredTri)
    this.#ctx.registerProgram(this.#texturedQuad)
    this.#ctx.registerProgram(this.#stroke)
    this.#ctx.registerProgram(this.#sdf)
    this.#ctx.registerProgram(this.#gradientRadial)
    this.#ctx.registerProgram(this.#maskedGradient)
    this.#ctx.registerProgram(this.#textQuad)
    this.#initGpuResources()
  }

  /**
   * (Re)create every GL resource. Called from the constructor and from
   * `rebuildResources` on context restore.
   */
  #initGpuResources(): void {
    const device = this.#device
    const unitQuadBuffer: VBuffer = device.createVertexBuffer(6 * 2 * 4)
    const unit = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1])
    device.updateBufferSubData(unitQuadBuffer, 0, unit)
    this.#ctx.unitQuadBuffer = unitQuadBuffer

    this.#coloredTri.init(device, this.#ctx)
    this.#texturedQuad.init(device, this.#ctx)
    this.#stroke.init(device, this.#ctx)
    this.#sdf.init(device, this.#ctx)
    this.#gradientRadial.init(device, this.#ctx)
    this.#maskedGradient.init(device, this.#ctx)
    this.#textQuad.init(device, this.#ctx)

    this.#target = device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
    })
    // Reflect the effective (post-clamp) sample count in stats so the HUD
    // shows what the driver actually gave us, not what we asked for.
    this.stats.msaaSamples = this.#target.samples

    // TextureManager owns every texture, atlas, per-source cache,
    // static-map, gradient LUTs. On rebuild it re-creates GL resources
    // from surviving CPU-side backing state.
    if (this.#textureManager) {
      this.#textureManager.rebuild(device)
    } else {
      this.#textureManager = new TextureManager(device)
    }
    this.#ctx.textureManager = this.#textureManager
  }

  /**
   * Read-only view of the texture caches for the debug inspector. Building the
   * snapshot has no standing cost, the debug panel calls it on demand.
   */
  get textureInspector(): TextureInspector {
    return this.#textureManager
  }

  // --- frame lifecycle ------------------------------------------------------

  /**
   * Rotate ring slot, bind FBO, clear. `pixelW`/`pixelH` are ignored (FBO clear
   * covers the target), only present so Canvas2DGfx and GpuGfx share a
   * `beginFrame` shape.
   */
  beginFrame(opts: {
    clearColor: string
    transparent: boolean
    pixelW: number
    pixelH: number
  }): void {
    void opts.pixelW
    void opts.pixelH
    // Rotate ring slot.
    this.#ctx.curSlot = (this.#ctx.curSlot + 1) % RING_SIZE
    this.#ctx.resetSlot(this.#ctx.curSlot)
    this.#textureManager.resetLabelBudget()
    this.#ctx.resetBatchMarkers()
    // Reset per-frame stats so the HUD reflects the frame just rendered.
    this.stats.drawCalls = 0
    this.stats.programSwitches = 0
    this.stats.textureBinds = 0
    this.stats.blendSwitches = 0
    this.stats.overflowWarns = 0
    this.stats.sdfInstances = 0
    this.stats.strokeInstances = 0
    this.#updateProjection(this.#targetWidth, this.#targetHeight)
    this.#ctx.stateStack.resetBase()
    this.#ctx.txStack.setBase(1, 0, 0, 1, 0, 0)
    // Parse the CSS clear once; fully-transparent under `transparent: true`.
    const clear: readonly [number, number, number, number] = opts.transparent
      ? [0, 0, 0, 0]
      : rgbaTuple(parseColor(opts.clearColor))
    this.#device.beginFrame({ target: this.#target, clearColor: clear })
    this.#ctx.curBlend = 'source-over'
  }

  /**
   * Explicit flush at layer boundary (Stage calls this between drawLayer
   * calls). Doesn't advance the ring slot, only commits the pending batch.
   */
  flush(): void {
    this.#ctx.flushActive()
  }

  /**
   * End of frame, flush anything pending and blit FBO to the canvas. If the
   * context was lost mid-frame, skip the flush + blit safely; `beginFrame` will
   * reset state next frame.
   */
  endFrame(): void {
    if (this.#device.isContextLost()) {
      return
    }
    this.#ctx.flushActive()
    this.#device.blitToDefault(
      this.#target,
      this.#canvas.width,
      this.#canvas.height,
      { filter: 'linear' },
    )
    this.#device.endFrame()
  }

  /**
   * Resize the internal render target. Idempotent. Deliberately does NOT
   * invalidate the static-map bake, the reprojection matrix in
   * `computeStaticReprojection` handles a stale bake at the old size. Do NOT
   * add `textureManager.invalidateStaticMapBake()` here, DynamicResolution's
   * mid-motion scale ticks would null the bake metadata before the reproject
   * blit could use it and the map goes invisible during zoom animations.
   */
  setInternalSize(pixelW: number, pixelH: number): void {
    if (pixelW === this.#targetWidth && pixelH === this.#targetHeight) return
    this.#targetWidth = pixelW
    this.#targetHeight = pixelH
    this.#device.resizeRenderTarget(this.#target, pixelW, pixelH)
  }

  /** No-op. `WebGL2Device.onRestored` drives reacquisition. */
  reacquireContext(): void {}

  /**
   * Rebuild every GL resource after `webglcontextrestored`. Programs, buffers,
   * VAOs, FBO, atlas texture. CPU-side state (batch flags, transform/state
   * stacks, stats, texture manager's backing canvases) survives the loss.
   */
  rebuildResources(): void {
    if (this.#device.isContextLost()) {
      console.warn(
        'GpuGfx.rebuildResources: called while context is still lost; skipping. Stage will retry on the next contextrestored event.',
      )
      return
    }
    // Clear batch state, old handles are dead.
    this.#ctx.resetBatchMarkers()
    // Reset ring cursors so the first new frame starts from a clean slot.
    this.#ctx.curSlot = 0
    this.#initGpuResources()
  }

  // --- Gfx2D: transform ----------------------------------------------------

  setBaseTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.#ctx.txStack.setBase(a, b, c, d, e, f)
  }

  save(): void {
    this.#ctx.txStack.push()
    this.#ctx.stateStack.push()
  }

  restore(): void {
    this.#ctx.txStack.pop()
    this.#ctx.stateStack.pop()
  }

  translate(x: number, y: number): void {
    this.#ctx.txStack.translate(x, y)
  }

  rotate(rad: number): void {
    this.#ctx.txStack.rotate(rad)
  }

  scale(sx: number, sy: number): void {
    this.#ctx.txStack.scale(sx, sy)
  }

  // --- Gfx2D: alpha + blend ------------------------------------------------

  setAlpha(alpha: number): void {
    // Absolute (matches Canvas globalAlpha; see Gfx2D docstring).
    this.#ctx.stateStack.setAlpha(alpha)
  }

  setBlend(mode: import('../Gfx2D').GfxBlend): void {
    this.#ctx.stateStack.setBlend(mode)
  }

  setClipMask(mask: BitmapMask | null): void {
    // Just stores on the state stack. The actual GPU state change (uniform
    // set + texture bind) happens lazily inside `ColoredTriProgram.begin` /
    // `flush` when the effective mask differs from the batch's baked-in
    // mask, matches how blend + texture flips force a flush.
    this.#ctx.stateStack.setClipMask(mask)
  }

  /**
   * Switch the debug render mode. Global state (not stack-scoped), the debug
   * HUD is the sole caller and it wants ALL draws affected until toggled off.
   * Flushes the current batch so old-mode pixels finish out before the new-mode
   * uniforms take effect.
   */
  setDebugRenderMode(mode: DebugRenderMode): void {
    if (this.#ctx.curDebugMode === mode) return
    this.#ctx.flushActive()
    this.#ctx.curDebugMode = mode
  }

  /** Current debug render mode. Read by the HUD to reflect state. */
  getDebugRenderMode(): DebugRenderMode {
    return this.#ctx.curDebugMode
  }

  /**
   * Live-swap MSAA sample count. Flushes, deletes the FBO, allocates a fresh
   * one. The device clamps to `[1, MAX_SAMPLES]`, `stats.msaaSamples` mirrors
   * the effective post-clamp count for the HUD.
   */
  setSamples(samples: number): void {
    const requested = Math.max(0, Math.floor(samples))
    // Store the request so a subsequent context-loss rebuild picks it up.
    // Actual clamp/effective count read from `this.target.samples`.
    if (this.#samples === requested) return
    this.#ctx.flushActive()
    this.#samples = requested
    this.#device.deleteRenderTarget(this.#target)
    this.#target = this.#device.createRenderTarget({
      width: this.#targetWidth,
      height: this.#targetHeight,
      samples: this.#samples,
    })
    this.stats.msaaSamples = this.#target.samples
  }

  /** Current effective MSAA sample count (post-clamp). */
  getSamples(): number {
    return this.#target.samples
  }

  /**
   * `'polygons'` debug mode: thin wireframe around a local-space polygon. Width
   * inverts the current transform's uniform scale so it stays ~1 device pixel
   * regardless of zoom.
   */
  #emitDebugPolygonOutline(
    pts: ArrayLike<number>,
    count: number,
    closed: boolean,
  ): void {
    if (count < 2) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const scale = det > 1e-9 ? Math.sqrt(det) : 1
    const style: GfxStrokeStyle = {
      color: 'rgba(96, 165, 250, 0.75)',
      width: 1 / scale,
    }
    for (let i = 0; i < count - 1; i++) {
      this.strokeLine(
        pts[i * 2],
        pts[i * 2 + 1],
        pts[(i + 1) * 2],
        pts[(i + 1) * 2 + 1],
        style,
      )
    }
    if (closed && count >= 3) {
      const last = count - 1
      this.strokeLine(pts[last * 2], pts[last * 2 + 1], pts[0], pts[1], style)
    }
  }

  // --- Gfx2D: fills --------------------------------------------------------

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    this.#coloredTri.fillRect(this.#ctx, x, y, w, h, color)
    if (this.#ctx.curDebugMode === 'polygons') {
      // Rect corners CCW starting from A. `emitDebugPolygonOutline`
      // handles the closing edge.
      const rectPts = [x, y, x + w, y, x + w, y + h, x, y + h]
      this.#emitDebugPolygonOutline(rectPts, 4, true)
    }
  }

  fillCircle(cx: number, cy: number, r: number, color: string): void {
    this.#sdf.fillCircle(this.#ctx, cx, cy, r, color)
  }

  fillConvexPoly(pts: ArrayLike<number>, count: number, color: string): void {
    this.#coloredTri.fillConvexPoly(this.#ctx, pts, count, color)
    if (this.#ctx.curDebugMode === 'polygons') {
      this.#emitDebugPolygonOutline(pts, count, true)
    }
  }

  fillPath2D(path: Path2D, color: string): void {
    const geo = getPathTessellation(path)
    if (!geo) {
      // Direct-Path2D fallback. The triangulator needs the `d` string which
      // isn't recoverable from a Path2D at runtime, so nodes that construct
      // Path2Ds outside `SvgPathMap` must call `registerTessellation`
      // explicitly. Silent counter tick surfaces it in the HUD.
      this.unimplemented.fillPath2D++
      return
    }
    this.#coloredTri.fillTessellation(this.#ctx, geo, color)
    if (this.#ctx.curDebugMode === 'polygons') {
      // fillPath2D can render multiple sub-paths, walk the contour list
      // registered with the tessellation so the outline matches the fill.
      const contours = getPathContours(path)
      if (contours) {
        for (let i = 0; i < contours.length; i++) {
          const c = contours[i]
          this.#emitDebugPolygonOutline(
            c,
            c.length / 2,
            getContourClosed(path, i),
          )
        }
      }
    }
  }

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (r <= 0 || stops.length === 0) return
    const lut = this.#textureManager.ensureStopsLut(stops)
    if (!lut) return
    const off = this.#gradientRadial.beginInstance(this.#ctx, lut)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    const dcx = t.a * cx + t.c * cy + t.e
    const dcy = t.b * cx + t.d * cy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = r * Math.sqrt(det)
    const alpha = this.#ctx.stateStack.getAlpha()
    const f = this.#gradientRadial.floatView
    f[off + 0] = dcx
    f[off + 1] = dcy
    f[off + 2] = dr
    f[off + 3] = alpha
    f[off + 4] = 0
    f[off + 5] = 0
    this.#gradientRadial.commitInstance(slot)
  }

  fillMaskedRadialGradient(
    mask: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    gcx: number,
    gcy: number,
    gr: number,
    stops: readonly GfxGradientStop[],
  ): void {
    if (gr <= 0 || dw <= 0 || dh <= 0 || stops.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Axis-aligned assumption (same as drawImage): the background base
    // transform never rotates/skews.
    if (Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9) return
    const lut = this.#textureManager.ensureStopsLut(stops)
    if (!lut) return
    const entry = this.#textureManager.getOrCreateEntry(mask)
    if (entry === null) return
    let tex: Texture
    let u0: number, v0: number, u1: number, v1: number
    if ('srcRect' in entry) {
      tex = entry.tex
      const r = entry.srcRect
      u0 = r[0]
      v0 = r[1]
      u1 = r[2]
      v1 = r[3]
    } else {
      tex = entry
      u0 = 0
      v0 = 0
      u1 = 1
      v1 = 1
    }
    const off = this.#maskedGradient.beginInstance(this.#ctx, tex, lut)
    if (off < 0) return
    const slot = this.#ctx.curSlot
    const dstX = t.a * dx + t.e
    const dstY = t.d * dy + t.f
    const dstW = t.a * dw
    const dstH = t.d * dh
    const dcx = t.a * gcx + t.c * gcy + t.e
    const dcy = t.b * gcx + t.d * gcy + t.f
    const det = Math.abs(t.a * t.d - t.b * t.c)
    const dr = gr * Math.sqrt(det)
    const alpha = this.#ctx.stateStack.getAlpha()
    const f = this.#maskedGradient.floatView
    f[off + 0] = dstX
    f[off + 1] = dstY
    f[off + 2] = dstW
    f[off + 3] = dstH
    f[off + 4] = u0
    f[off + 5] = v0
    f[off + 6] = u1
    f[off + 7] = v1
    f[off + 8] = dcx
    f[off + 9] = dcy
    f[off + 10] = dr
    f[off + 11] = alpha
    this.#maskedGradient.commitInstance(slot)
  }

  fillPolyLinearGradient(
    pts: ArrayLike<number>,
    count: number,
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    colorStart: string,
    colorEnd: string,
  ): void {
    this.#coloredTri.fillPolyLinearGradient(
      this.#ctx,
      pts,
      count,
      x0,
      y0,
      x1,
      y1,
      colorStart,
      colorEnd,
    )
    if (this.#ctx.curDebugMode === 'polygons') {
      this.#emitDebugPolygonOutline(pts, count, true)
    }
  }

  // --- Gfx2D: strokes ------------------------------------------------------

  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void {
    this.#sdf.strokeCircle(this.#ctx, cx, cy, r, style)
  }

  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    this.#stroke.line(this.#ctx, x0, y0, x1, y1, style)
  }

  strokeQuadratic(
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    this.#stroke.quadratic(this.#ctx, x0, y0, cx, cy, x1, y1, style)
  }

  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    this.#stroke.polyline(this.#ctx, pts, count, style)
  }

  strokePath2D(path: Path2D, style: GfxStrokeStyle): void {
    const contours = getPathContours(path)
    if (!contours) {
      // No cached contours for this Path2D. Callers that construct
      // Path2Ds outside SvgPathMap must call `registerTessellation`
      // (which also stashes contours), the counter surfaces missing
      // registrations in the HUD.
      this.unimplemented.strokePath2D++
      return
    }
    for (let i = 0; i < contours.length; i++) {
      const c = contours[i]
      const count = c.length / 2
      if (count < 2) continue
      const closed = getContourClosed(path, i)
      const perContourStyle: GfxStrokeStyle = { ...style, closed }
      this.#stroke.polyline(this.#ctx, c, count, perContourStyle)
    }
  }

  // --- Gfx2D: images -------------------------------------------------------

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Phase 1 axis-aligned assumption: no rotation in the current transform.
    // Nodes that rotate (DebrisBurst, etc.) don't call drawImage in the game.
    if (Math.abs(t.b) > 1e-9 || Math.abs(t.c) > 1e-9) {
      this.unimplemented.drawImageWithRotation++
      if (!this.#warnedRotatedImage) {
        this.#warnedRotatedImage = true
        console.warn(
          'GpuGfx.drawImage: current transform has rotation/skew; Phase 1 draws axis-aligned only. Node ignored.',
        )
      }
      return
    }
    const entry = this.#textureManager.getOrCreateEntry(img)
    if (entry === null) return
    // Discriminate atlas entry vs standalone Texture. Atlas entries carry
    // a `srcRect` field; standalone Textures don't.
    let tex: Texture
    let u0: number, v0: number, u1: number, v1: number
    if ('srcRect' in entry) {
      tex = entry.tex
      const r = entry.srcRect
      u0 = r[0]
      v0 = r[1]
      u1 = r[2]
      v1 = r[3]
    } else {
      tex = entry
      u0 = 0
      v0 = 0
      u1 = 1
      v1 = 1
    }
    const words = this.#texturedQuad.beginInstance(this.#ctx, tex)
    if (words < 0) return
    const slot = this.#ctx.curSlot
    const alpha = this.#ctx.stateStack.getAlpha()
    const tintByte = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint =
      (tintByte << 24) | (tintByte << 16) | (tintByte << 8) | tintByte
    const dstX = t.a * dx + t.e
    const dstY = t.d * dy + t.f
    const dstW = t.a * dw
    const dstH = t.d * dh
    const fv = this.#texturedQuad.floatView
    const uv = this.#texturedQuad.uintView
    fv[words + 0] = dstX
    fv[words + 1] = dstY
    fv[words + 2] = dstW
    fv[words + 3] = dstH
    fv[words + 4] = u0
    fv[words + 5] = v0
    fv[words + 6] = u1
    fv[words + 7] = v1
    uv[words + 8] = packedTint >>> 0
    this.#texturedQuad.commitInstance(slot)
  }

  // --- Gfx2D: text ---------------------------------------------------------

  fillText(text: string, x: number, y: number, style: GfxTextStyle = {}): void {
    if (text.length === 0) return
    this.#ctx.txStack.read(this.#ctx.txOut)
    const t = this.#ctx.txOut
    // Net local→device scale, independent of rotation (columns of the linear
    // part). Drives how sharply the label is rasterized; rotation is free.
    const deviceScale = Math.max(Math.hypot(t.a, t.b), Math.hypot(t.c, t.d))
    if (!(deviceScale > 0)) return

    const resolved: LabelStyle = {
      font: style.font ?? DEFAULT_LABEL_FONT,
      align: style.align ?? 'left',
      baseline: style.baseline ?? 'alphabetic',
      color: style.color ?? '#000',
    }
    // Cache key: scale-independent style. TextureManager appends the scale
    // bucket. Newline separators are collision-free: labels are single-line, so
    // the text can't contain one, and font/align/baseline/color never do.
    const baseKey = `${text}\n${resolved.font}\n${resolved.align}\n${resolved.baseline}\n${resolved.color}\n`
    const label = this.#textureManager.ensureLabelTexture(
      baseKey,
      text,
      resolved,
      deviceScale,
    )
    if (label === null) return

    // Local-space dst rect: bitmap top-left relative to the (x, y) anchor.
    const dx = x - label.anchorOffsetX
    const dy = y - label.anchorOffsetY
    const w = label.localW
    const h = label.localH
    // Affine mapping the unit square [0,1]² → device px:
    //   pos = col0 * u + col1 * v + translate
    const col0x = t.a * w
    const col0y = t.b * w
    const col1x = t.c * h
    const col1y = t.d * h
    let tx = t.a * dx + t.c * dy + t.e
    let ty = t.b * dx + t.d * dy + t.f
    // Subpixel snap for axis-aligned draws (all screen-space labels, and any
    // non-rotated world label): land the 1:1 texels on whole device pixels so
    // they don't smear. Skip when rotated/skewed (snapping wouldn't align).
    if (Math.abs(t.b) < 1e-6 && Math.abs(t.c) < 1e-6) {
      tx = Math.round(tx)
      ty = Math.round(ty)
    }

    // Tint = white × alpha (premultiplied). Baked glyph color is preserved;
    // this only applies the current alpha (and keeps emoji multi-color).
    const alpha = this.#ctx.stateStack.getAlpha()
    const a = Math.max(0, Math.min(255, Math.round(alpha * 255)))
    const packedTint = ((a << 24) | (a << 16) | (a << 8) | a) >>> 0

    const words = this.#textQuad.beginInstance(this.#ctx, label.tex)
    if (words < 0) return
    const slot = this.#ctx.curSlot
    const fv = this.#textQuad.floatView
    const uv = this.#textQuad.uintView
    fv[words + 0] = col0x
    fv[words + 1] = col0y
    fv[words + 2] = col1x
    fv[words + 3] = col1y
    fv[words + 4] = tx
    fv[words + 5] = ty
    fv[words + 6] = 0 // u0
    fv[words + 7] = 0 // v0
    fv[words + 8] = 1 // u1
    fv[words + 9] = 1 // v1
    uv[words + 10] = packedTint
    this.#textQuad.commitInstance(slot)
  }

  // --- registration (called by asset loaders) -------------------------------

  /**
   * Install a tessellation for a given `Path2D` so subsequent `fillPath2D(path,
   * …)` and `strokePath2D(path, …)` calls resolve against a cached
   * triangulation / contour set. Delegates to the process-wide
   * `PathTessellationRegistry`; nodes and asset loaders can also register there
   * directly.
   */
  registerTessellation(
    path: Path2D,
    geometry: GeometryHandle,
    contours?: Float32Array[],
  ): void {
    registerPathTessellation(path, geometry, contours)
  }

  #updateProjection(w: number, h: number): void {
    // Device-px → clip with Y-flip.
    // clip.x = 2 * x / w - 1
    // clip.y = 1 - 2 * y / h
    // As a column-major mat3:
    //   col 0: [2/w, 0, 0]
    //   col 1: [0, -2/h, 0]
    //   col 2: [-1, 1, 1]
    const p = this.#ctx.projMat
    p[0] = 2 / w
    p[1] = 0
    p[2] = 0
    p[3] = 0
    p[4] = -2 / h
    p[5] = 0
    p[6] = -1
    p[7] = 1
    p[8] = 1
  }
}

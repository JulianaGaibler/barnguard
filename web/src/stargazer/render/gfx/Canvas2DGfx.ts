import type { Gfx2D, GfxBlend, GfxGradientStop, GfxStrokeStyle } from './Gfx2D'
import type { BitmapMask } from '../../assets/BitmapMask'

const TAU = Math.PI * 2
/** Shared "no dash" argument so `setLineDash` calls don't allocate. */
const NO_DASH: number[] = []

export interface Canvas2DGfxOptions {
  /**
   * Match the Renderer's transparent flag; forwarded to `getContext('2d',
   * {alpha})`.
   */
  transparent?: boolean
}

/**
 * `Gfx2D` backed by a `CanvasRenderingContext2D`. Every method is a faithful
 * 1:1 translation of the drawing the old node code did directly on `ctx`, so
 * swapping a node from `draw(ctx, …)` to `draw(gfx, …)` is pixel-for-pixel
 * identical. This is the reference implementation and the visual-parity oracle
 * the GPU backend is diffed against.
 *
 * Two construction forms:
 *
 * - `new Canvas2DGfx(ctx)`, wraps an existing context. Used by `Layers` for the
 *   offscreen static-bake ctx and by tests. `setContext` retargets between
 *   contexts without reallocating.
 * - `new Canvas2DGfx(canvas, opts)`, acquires `getContext('2d')` from the canvas.
 *   This form is what Stage uses under `?renderer=canvas2d`, so context
 *   ownership sits with the facade (matching the GPU backend, which owns its
 *   `WebGL2RenderingContext`). It also enables `reacquireContext` after a
 *   browser context-loss event.
 */
export class Canvas2DGfx implements Gfx2D {
  ctx: CanvasRenderingContext2D
  private readonly owningCanvas: HTMLCanvasElement | null
  private readonly transparent: boolean

  constructor(ctx: CanvasRenderingContext2D)
  constructor(canvas: HTMLCanvasElement, opts?: Canvas2DGfxOptions)
  constructor(
    arg: CanvasRenderingContext2D | HTMLCanvasElement,
    opts: Canvas2DGfxOptions = {},
  ) {
    this.transparent = opts.transparent ?? false
    if (arg instanceof HTMLCanvasElement) {
      const ctx = arg.getContext('2d', { alpha: this.transparent })
      if (!ctx) throw new Error('Canvas2DGfx: failed to acquire 2D context')
      this.ctx = ctx
      this.owningCanvas = arg
    } else {
      this.ctx = arg
      this.owningCanvas = null
    }
  }

  /** Retarget this facade at a different 2D context (main ↔ bake). */
  setContext(ctx: CanvasRenderingContext2D): void {
    this.ctx = ctx
  }

  /**
   * Re-acquire the 2D context after a `contextrestored` event. Only valid when
   * this facade owns its canvas (i.e. constructed with the canvas form).
   */
  reacquireContext(): void {
    if (!this.owningCanvas) return
    const ctx = this.owningCanvas.getContext('2d', { alpha: this.transparent })
    if (!ctx) throw new Error('Canvas2DGfx: failed to re-acquire 2D context')
    this.ctx = ctx
  }

  // --- frame lifecycle (renderer-agnostic hooks Stage duck-types) ----------

  /**
   * Reset transform + clear the whole backing store. `clearColor` and
   * `transparent` are passed in per-frame so the same facade can serve a
   * primary + secondary stage with different clear behavior.
   */
  beginFrame(opts: {
    clearColor: string
    transparent: boolean
    pixelW: number
    pixelH: number
  }): void {
    const ctx = this.ctx
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    if (opts.transparent) {
      ctx.clearRect(0, 0, opts.pixelW, opts.pixelH)
    } else {
      ctx.fillStyle = opts.clearColor
      ctx.fillRect(0, 0, opts.pixelW, opts.pixelH)
    }
  }

  /** No-op on Canvas, the ctx has already committed each draw. */
  endFrame(): void {
    /* intentional no-op */
  }

  /**
   * No-op on Canvas, `Renderer.resize` already changed `canvas.width/height`
   * which is the "internal size" for the 2D backend. Under GPU this method
   * resizes the FBO.
   */
  setInternalSize(_pixelW: number, _pixelH: number): void {
    /* intentional no-op */
  }

  /**
   * Context-loss recovery hook Stage duck-types. Canvas2DGfx has nothing to
   * rebuild beyond re-acquiring the ctx (done in `reacquireContext`).
   */
  rebuildResources(): void {
    /* intentional no-op */
  }

  // --- transform + state ---------------------------------------------------

  setBaseTransform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.ctx.setTransform(a, b, c, d, e, f)
  }

  save(): void {
    this.ctx.save()
  }

  restore(): void {
    this.ctx.restore()
  }

  translate(x: number, y: number): void {
    this.ctx.translate(x, y)
  }

  rotate(rad: number): void {
    this.ctx.rotate(rad)
  }

  scale(sx: number, sy: number): void {
    this.ctx.scale(sx, sy)
  }

  setAlpha(alpha: number): void {
    this.ctx.globalAlpha = alpha
  }

  setBlend(mode: GfxBlend): void {
    this.ctx.globalCompositeOperation = mode
  }

  setClipMask(_mask: BitmapMask | null): void {
    // Canvas2D no-op, see `Gfx2D.setClipMask` for the seam.
    // GridOverlayNode (the only in-tree caller) runs on the GPU stage, so
    // Canvas2D fallback shows the historical coastal overhang. If a
    // Canvas2D consumer ever needs real clipping, retain the source Path2D
    // on BitmapMask and do `ctx.save(); ctx.clip(mask.path)` /
    // `ctx.restore()` here.
  }

  /**
   * Draw a text label. **Not part of the `Gfx2D` interface**, the GPU backend
   * has no text-rendering subsystem, and building one for debug-only glyphs
   * would be overkill. `DebugController` duck-types `if ('fillText' in gfx)` so
   * labels render under Canvas mode and silently drop under GPU.
   * Font/align/baseline default to values that match the previous inline
   * `ctx.fillText` calls.
   */
  fillText(
    text: string,
    x: number,
    y: number,
    opts: {
      font?: string
      align?: CanvasTextAlign
      baseline?: CanvasTextBaseline
      color?: string
    } = {},
  ): void {
    const c = this.ctx
    if (opts.font !== undefined) c.font = opts.font
    if (opts.align !== undefined) c.textAlign = opts.align
    if (opts.baseline !== undefined) c.textBaseline = opts.baseline
    if (opts.color !== undefined) c.fillStyle = opts.color
    c.fillText(text, x, y)
  }

  // --- fills ---------------------------------------------------------------

  fillRect(x: number, y: number, w: number, h: number, color: string): void {
    const c = this.ctx
    c.fillStyle = color
    c.fillRect(x, y, w, h)
  }

  fillCircle(cx: number, cy: number, r: number, color: string): void {
    const c = this.ctx
    c.beginPath()
    c.arc(cx, cy, r, 0, TAU)
    c.fillStyle = color
    c.fill()
  }

  fillConvexPoly(pts: ArrayLike<number>, count: number, color: string): void {
    if (count < 3) return
    const c = this.ctx
    c.beginPath()
    c.moveTo(pts[0], pts[1])
    for (let i = 1; i < count; i++) {
      c.lineTo(pts[i * 2], pts[i * 2 + 1])
    }
    c.closePath()
    c.fillStyle = color
    c.fill()
  }

  fillPath2D(path: Path2D, color: string): void {
    const c = this.ctx
    c.fillStyle = color
    c.fill(path)
  }

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: readonly GfxGradientStop[],
  ): void {
    const c = this.ctx
    const grad = c.createRadialGradient(cx, cy, 0, cx, cy, r)
    for (let i = 0; i < stops.length; i++) {
      grad.addColorStop(stops[i].offset, stops[i].color)
    }
    c.fillStyle = grad
    c.beginPath()
    c.arc(cx, cy, r, 0, TAU)
    c.fill()
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
    if (count < 2) return
    const c = this.ctx
    c.beginPath()
    c.moveTo(pts[0], pts[1])
    for (let i = 1; i < count; i++) {
      c.lineTo(pts[i * 2], pts[i * 2 + 1])
    }
    c.closePath()
    const grad = c.createLinearGradient(x0, y0, x1, y1)
    grad.addColorStop(0, colorStart)
    grad.addColorStop(1, colorEnd)
    c.fillStyle = grad
    c.fill()
  }

  // --- strokes -------------------------------------------------------------

  private applyStroke(style: GfxStrokeStyle): void {
    const c = this.ctx
    c.strokeStyle = style.color
    c.lineWidth = style.width
    c.lineCap = style.cap ?? 'butt'
    c.lineJoin = style.join ?? 'miter'
    c.setLineDash(style.dash ? (style.dash as number[]) : NO_DASH)
  }

  strokeCircle(cx: number, cy: number, r: number, style: GfxStrokeStyle): void {
    this.applyStroke(style)
    const c = this.ctx
    c.beginPath()
    c.arc(cx, cy, r, 0, TAU)
    c.stroke()
  }

  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxStrokeStyle,
  ): void {
    this.applyStroke(style)
    const c = this.ctx
    c.beginPath()
    c.moveTo(x0, y0)
    c.lineTo(x1, y1)
    c.stroke()
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
    this.applyStroke(style)
    const c = this.ctx
    c.beginPath()
    c.moveTo(x0, y0)
    c.quadraticCurveTo(cx, cy, x1, y1)
    c.stroke()
  }

  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: GfxStrokeStyle,
  ): void {
    if (count < 2) return
    this.applyStroke(style)
    const c = this.ctx
    c.beginPath()
    c.moveTo(pts[0], pts[1])
    const smoothing = style.smoothing ?? 'none'
    if (smoothing === 'none' || count < 3) {
      for (let i = 1; i < count; i++) {
        c.lineTo(pts[i * 2], pts[i * 2 + 1])
      }
    } else {
      // Quadratic-Bézier midpoint smoothing, mirrors PolylineNode's original
      // path construction exactly: control = P_i, anchors = segment midpoints.
      const firstMx = (pts[0] + pts[2]) * 0.5
      const firstMy = (pts[1] + pts[3]) * 0.5
      c.lineTo(firstMx, firstMy)
      for (let i = 1; i < count - 1; i++) {
        const cx = pts[i * 2]
        const cy = pts[i * 2 + 1]
        const nx = pts[(i + 1) * 2]
        const ny = pts[(i + 1) * 2 + 1]
        const mx = (cx + nx) * 0.5
        const my = (cy + ny) * 0.5
        c.quadraticCurveTo(cx, cy, mx, my)
      }
      c.lineTo(pts[(count - 1) * 2], pts[(count - 1) * 2 + 1])
    }
    if (style.closed) c.closePath()
    c.stroke()
  }

  strokePath2D(path: Path2D, style: GfxStrokeStyle): void {
    this.applyStroke(style)
    this.ctx.stroke(path)
  }

  // --- images --------------------------------------------------------------

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
  ): void {
    this.ctx.drawImage(img, dx, dy, dw, dh)
  }
}

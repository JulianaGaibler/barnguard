import type { CameraView2D } from '../../camera/CameraView2D'
import type { Rect } from '../../math/Rect'
import type { RoundRectRadii } from '../gfx/roundRectRadii'
import type {
  Gfx2D,
  GfxBlend,
  GfxClipShape,
  GfxFill,
  GfxImageOptions,
  GfxShadowStyle,
  GfxTextStyle,
} from '../gfx/Gfx2D'
import { textMetrics } from '../gfx/textLayout'
import { Op, Picture, type CanvasStrokeStyle, type Versioned } from './Picture'

/** Extra local units around a text label for the bitmap's transparent padding. */
const TEXT_PAD = 2
/** Device pixels the antialiased edge of any stroke reaches beyond its width. */
const EDGE_PAD = 1

type Fill = GfxFill
type Radii = RoundRectRadii

/**
 * The recorder a node's `paint` draws into. It has the drawing vocabulary of
 * {@link Gfx2D}, in the node's local space, and keeps the calls in a
 * {@link Picture} that the engine replays every frame until the node is dirtied
 * again.
 *
 * @remarks
 *   Arguments are copied when recorded, so a scratch array or a style object
 *   reused by the caller can change afterwards without changing the picture.
 *   Resources (images, paths) are kept by reference, and a path is tracked by
 *   its `version`, so editing it repaints the node.
 *
 *   Alpha set here is relative to the node's own cascaded alpha. A stroke width
 *   can be `{ screen: n }`, which means `n` CSS pixels at any zoom.
 *
 *   A canvas is valid only while `paint` runs. In development a call after it
 *   throws.
 */
export class Canvas {
  #pic: Picture | null = null
  #view: CameraView2D | null = null
  #deviceScale = 1
  /** The node's local transform as the picture is recorded, for bounds. */
  #a = 1
  #b = 0
  #c = 0
  #d = 1
  #e = 0
  #f = 0
  readonly #stack: number[] = []

  /** @internal Start recording into `picture`. */
  begin(picture: Picture, deviceScale: number, view: CameraView2D): void {
    picture.clear()
    this.#pic = picture
    this.#view = view
    this.#deviceScale = deviceScale
    this.#a = 1
    this.#b = 0
    this.#c = 0
    this.#d = 1
    this.#e = 0
    this.#f = 0
    this.#stack.length = 0
  }

  /** @internal Finish the picture. */
  end(): void {
    this.#pic = null
    this.#view = null
  }

  #open(): Picture {
    const pic = this.#pic
    if (!pic) throw new Error('Canvas: used outside of paint')
    return pic
  }

  #rec(op: number, ...args: unknown[]): void {
    const pic = this.#open()
    pic.ops.push(op)
    pic.args.push(args)
  }

  // --- what the picture depends on -----------------------------------------

  /**
   * Redraw the node when `resource.version` changes. Paths drawn through
   * `fillPath` and `strokePath` are tracked without asking.
   */
  use(resource: Versioned): void {
    const pic = this.#open()
    if (pic.deps.includes(resource)) return
    pic.deps.push(resource)
    pic.depVersions.push(resource.version)
  }

  /**
   * `length` local units rounded to a whole number of device pixels at the
   * scale the node is drawn at. Marks the picture as depending on the scale, so
   * it is redrawn when the scale settles at a different size.
   */
  snap(length: number): number {
    this.#open().scaleDependent = true
    const s = this.#deviceScale
    return s > 0 ? Math.max(1, Math.round(length * s)) / s : length
  }

  /**
   * The world rect the camera shows. Marks the picture as depending on the
   * camera, so it is redrawn when the view changes.
   */
  visibleWorldRect(): Rect {
    const pic = this.#open()
    const r = this.#view!.visibleWorldRect()
    pic.usesCamera = true
    pic.cameraX = r.x
    pic.cameraY = r.y
    pic.cameraW = r.width
    pic.cameraH = r.height
    return r
  }

  /**
   * World units per CSS pixel, for sizes written in screen pixels that should
   * stay that size at any zoom. Marks the picture as depending on it, so it is
   * redrawn when the scale changes.
   */
  screenScale(): number {
    const pic = this.#open()
    const s = this.#view!.strokeSpaceScale()
    pic.usesScreenScale = true
    pic.screenScale = s
    return s
  }

  // --- transform and state --------------------------------------------------

  save(): void {
    this.#rec(Op.save)
    this.#stack.push(this.#a, this.#b, this.#c, this.#d, this.#e, this.#f)
  }

  restore(): void {
    this.#rec(Op.restore)
    const s = this.#stack
    if (s.length < 6) return
    this.#f = s.pop()!
    this.#e = s.pop()!
    this.#d = s.pop()!
    this.#c = s.pop()!
    this.#b = s.pop()!
    this.#a = s.pop()!
  }

  translate(x: number, y: number): void {
    this.#rec(Op.translate, x, y)
    this.#e += this.#a * x + this.#c * y
    this.#f += this.#b * x + this.#d * y
  }

  rotate(rad: number): void {
    this.#rec(Op.rotate, rad)
    this.#mul(Math.cos(rad), Math.sin(rad), -Math.sin(rad), Math.cos(rad), 0, 0)
  }

  scale(sx: number, sy: number): void {
    this.#rec(Op.scale, sx, sy)
    this.#mul(sx, 0, 0, sy, 0, 0)
  }

  transform(
    a: number,
    b: number,
    c: number,
    d: number,
    e: number,
    f: number,
  ): void {
    this.#rec(Op.transform, a, b, c, d, e, f)
    this.#mul(a, b, c, d, e, f)
  }

  #mul(a: number, b: number, c: number, d: number, e: number, f: number): void {
    const na = this.#a * a + this.#c * b
    const nb = this.#b * a + this.#d * b
    const nc = this.#a * c + this.#c * d
    const nd = this.#b * c + this.#d * d
    const ne = this.#a * e + this.#c * f + this.#e
    const nf = this.#b * e + this.#d * f + this.#f
    this.#a = na
    this.#b = nb
    this.#c = nc
    this.#d = nd
    this.#e = ne
    this.#f = nf
  }

  /** Alpha relative to the node's own: the node's alpha multiplies into it. */
  setAlpha(alpha: number): void {
    this.#rec(Op.setAlpha, alpha)
  }

  setBlend(mode: GfxBlend): void {
    this.#rec(Op.setBlend, mode)
  }

  setClipMask(mask: Parameters<Gfx2D['setClipMask']>[0]): void {
    this.#rec(Op.setClipMask, mask)
  }

  setClip(shape: GfxClipShape | null): void {
    this.#rec(Op.setClip, shape && { ...shape })
  }

  clipPath(
    path: Parameters<Gfx2D['clipPath']>[0],
    rule?: Parameters<Gfx2D['clipPath']>[1],
  ): void {
    this.use(path)
    this.#rec(Op.clipPath, path, rule)
  }

  // --- bounds ---------------------------------------------------------------

  /** Grow the bounds by a local box, through the current transform. */
  #box(x0: number, y0: number, x1: number, y1: number): void {
    const pic = this.#open()
    const a = this.#a
    const b = this.#b
    const c = this.#c
    const d = this.#d
    const e = this.#e
    const f = this.#f
    for (let k = 0; k < 4; k++) {
      const x = k & 1 ? x1 : x0
      const y = k & 2 ? y1 : y0
      const wx = a * x + c * y + e
      const wy = b * x + d * y + f
      if (wx < pic.minX) pic.minX = wx
      if (wx > pic.maxX) pic.maxX = wx
      if (wy < pic.minY) pic.minY = wy
      if (wy > pic.maxY) pic.maxY = wy
    }
  }

  /**
   * The reach of a stroke beyond its geometry. An outside-aligned border lies
   * wholly outside, and every other alignment is centered on the edge or
   * inside.
   */
  #reach(style: CanvasStrokeStyle): number {
    const outside = style.align === 'outside'
    const width = style.width
    if (typeof width === 'number') {
      return Math.abs(width) * (outside ? 1 : 0.5) + EDGE_PAD
    }
    const pic = this.#open()
    pic.screenPad = Math.max(
      pic.screenPad,
      width.screen * (outside ? 1 : 0.5) + EDGE_PAD,
    )
    return 0
  }

  #unbounded(): void {
    this.#open().unbounded = true
  }

  // --- shapes ---------------------------------------------------------------

  fillRect(x: number, y: number, w: number, h: number, fill: Fill): void {
    this.#rec(Op.fillRect, x, y, w, h, snapFill(fill))
    this.#box(x, y, x + w, y + h)
  }

  fillRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: Radii,
    fill: Fill,
    smoothing = 0,
  ): void {
    this.#rec(
      Op.fillRoundRect,
      x,
      y,
      w,
      h,
      snapRadii(radii),
      snapFill(fill),
      smoothing,
    )
    this.#box(x, y, x + w, y + h)
  }

  strokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: Radii,
    style: CanvasStrokeStyle,
    smoothing = 0,
  ): void {
    this.#rec(
      Op.strokeRoundRect,
      x,
      y,
      w,
      h,
      snapRadii(radii),
      snapStroke(style),
      smoothing,
    )
    const r = this.#reach(style)
    this.#box(x - r, y - r, x + w + r, y + h + r)
  }

  fillAndStrokeRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: Radii,
    fill: Fill,
    style: CanvasStrokeStyle,
    smoothing = 0,
  ): void {
    this.#rec(
      Op.fillAndStrokeRoundRect,
      x,
      y,
      w,
      h,
      snapRadii(radii),
      snapFill(fill),
      snapStroke(style),
      smoothing,
    )
    const r = this.#reach(style)
    this.#box(x - r, y - r, x + w + r, y + h + r)
  }

  fillCircle(cx: number, cy: number, r: number, fill: Fill): void {
    this.#rec(Op.fillCircle, cx, cy, r, snapFill(fill))
    this.#box(cx - r, cy - r, cx + r, cy + r)
  }

  fillAndStrokeCircle(
    cx: number,
    cy: number,
    r: number,
    fill: Fill,
    style: CanvasStrokeStyle,
  ): void {
    this.#rec(
      Op.fillAndStrokeCircle,
      cx,
      cy,
      r,
      snapFill(fill),
      snapStroke(style),
    )
    const reach = r + this.#reach(style)
    this.#box(cx - reach, cy - reach, cx + reach, cy + reach)
  }

  fillEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: Fill,
  ): void {
    this.#rec(Op.fillEllipse, cx, cy, rx, ry, snapFill(fill))
    this.#box(cx - rx, cy - ry, cx + rx, cy + ry)
  }

  strokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    style: CanvasStrokeStyle,
  ): void {
    this.#rec(Op.strokeEllipse, cx, cy, rx, ry, snapStroke(style))
    const reach = this.#reach(style)
    this.#box(
      cx - rx - reach,
      cy - ry - reach,
      cx + rx + reach,
      cy + ry + reach,
    )
  }

  fillAndStrokeEllipse(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    fill: Fill,
    style: CanvasStrokeStyle,
  ): void {
    this.#rec(
      Op.fillAndStrokeEllipse,
      cx,
      cy,
      rx,
      ry,
      snapFill(fill),
      snapStroke(style),
    )
    const reach = this.#reach(style)
    this.#box(
      cx - rx - reach,
      cy - ry - reach,
      cx + rx + reach,
      cy + ry + reach,
    )
  }

  strokeCircle(
    cx: number,
    cy: number,
    r: number,
    style: CanvasStrokeStyle,
  ): void {
    this.#rec(Op.strokeCircle, cx, cy, r, snapStroke(style))
    const reach = r + this.#reach(style)
    this.#box(cx - reach, cy - reach, cx + reach, cy + reach)
  }

  fillConvexPoly(pts: ArrayLike<number>, count: number, fill: Fill): void {
    this.#rec(Op.fillConvexPoly, copyPoints(pts, count), count, snapFill(fill))
    this.#points(pts, count, 0)
  }

  #points(pts: ArrayLike<number>, count: number, reach: number): void {
    if (count < 1) return
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < count; i++) {
      const x = pts[i * 2]
      const y = pts[i * 2 + 1]
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
    this.#box(x0 - reach, y0 - reach, x1 + reach, y1 + reach)
  }

  // --- paths ----------------------------------------------------------------

  fillPath2D(path: Path2D, fill: Fill): void {
    this.#rec(Op.fillPath2D, path, snapFill(fill))
    this.#unbounded()
  }

  fillPath(
    path: Parameters<Gfx2D['fillPath']>[0],
    fill: Fill,
    rule?: Parameters<Gfx2D['fillPath']>[2],
  ): void {
    this.use(path)
    this.#rec(Op.fillPath, path, snapFill(fill), rule)
    this.#pathBox(path, 0)
  }

  strokePath(
    path: Parameters<Gfx2D['strokePath']>[0],
    style: CanvasStrokeStyle,
  ): void {
    this.use(path)
    this.#rec(Op.strokePath, path, snapStroke(style))
    this.#pathBox(path, this.#reach(style))
  }

  strokePath2D(path: Path2D, style: CanvasStrokeStyle): void {
    this.#rec(Op.strokePath2D, path, snapStroke(style))
    this.#unbounded()
  }

  #pathBox(path: Parameters<Gfx2D['fillPath']>[0], reach: number): void {
    const flat = path.flatten(1)
    if (flat.pointCount < 1) return
    this.#box(
      flat.minX - reach,
      flat.minY - reach,
      flat.maxX + reach,
      flat.maxY + reach,
    )
  }

  // --- strokes --------------------------------------------------------------

  strokeLine(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: CanvasStrokeStyle,
  ): void {
    this.#rec(Op.strokeLine, x0, y0, x1, y1, snapStroke(style))
    const r = this.#reach(style)
    this.#box(
      Math.min(x0, x1) - r,
      Math.min(y0, y1) - r,
      Math.max(x0, x1) + r,
      Math.max(y0, y1) + r,
    )
  }

  strokeQuadratic(
    x0: number,
    y0: number,
    cx: number,
    cy: number,
    x1: number,
    y1: number,
    style: CanvasStrokeStyle,
  ): void {
    this.#rec(Op.strokeQuadratic, x0, y0, cx, cy, x1, y1, snapStroke(style))
    const r = this.#reach(style)
    // The curve stays inside the hull of its three points.
    this.#box(
      Math.min(x0, cx, x1) - r,
      Math.min(y0, cy, y1) - r,
      Math.max(x0, cx, x1) + r,
      Math.max(y0, cy, y1) + r,
    )
  }

  strokePolyline(
    pts: ArrayLike<number>,
    count: number,
    style: CanvasStrokeStyle,
  ): void {
    this.#rec(
      Op.strokePolyline,
      copyPoints(pts, count),
      count,
      snapStroke(style),
    )
    this.#points(pts, count, this.#reach(style))
  }

  // --- gradients ------------------------------------------------------------

  fillCircleRadialGradient(
    cx: number,
    cy: number,
    r: number,
    stops: Parameters<Gfx2D['fillCircleRadialGradient']>[3],
  ): void {
    this.#rec(Op.fillCircleRadialGradient, cx, cy, r, stops.slice())
    this.#box(cx - r, cy - r, cx + r, cy + r)
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
    stops: Parameters<Gfx2D['fillMaskedRadialGradient']>[8],
  ): void {
    this.#rec(
      Op.fillMaskedRadialGradient,
      mask,
      dx,
      dy,
      dw,
      dh,
      gcx,
      gcy,
      gr,
      stops.slice(),
    )
    this.#box(dx, dy, dx + dw, dy + dh)
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
    this.#rec(
      Op.fillPolyLinearGradient,
      copyPoints(pts, count),
      count,
      x0,
      y0,
      x1,
      y1,
      colorStart,
      colorEnd,
    )
    this.#points(pts, count, 0)
  }

  // --- shader quads, shadows, images, text ----------------------------------

  drawShaderQuad(
    quad: Parameters<Gfx2D['drawShaderQuad']>[0],
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    this.#rec(Op.drawShaderQuad, quad, x, y, w, h)
    this.#box(x, y, x + w, y + h)
  }

  /**
   * The box a shadow can reach: the shape's box grown by the shadow's offset,
   * blur and spread, in local units. An inset shadow stays inside the shape.
   */
  #shadowBox(
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    style: GfxShadowStyle,
  ): void {
    if (style.inset) {
      this.#box(x0, y0, x1, y1)
      return
    }
    const offset = Math.hypot(style.offsetX ?? 0, style.offsetY ?? 0)
    const reach =
      offset + (style.blur ?? 0) * 1.5 + Math.max(0, style.spread ?? 0)
    this.#box(x0 - reach, y0 - reach, x1 + reach, y1 + reach)
  }

  shadowRoundRect(
    x: number,
    y: number,
    w: number,
    h: number,
    radii: Radii,
    style: GfxShadowStyle,
    smoothing = 0,
  ): void {
    this.#rec(
      Op.shadowRoundRect,
      x,
      y,
      w,
      h,
      snapRadii(radii),
      { ...style },
      smoothing,
    )
    this.#shadowBox(x, y, x + w, y + h, style)
  }

  shadowCircle(cx: number, cy: number, r: number, style: GfxShadowStyle): void {
    this.#rec(Op.shadowCircle, cx, cy, r, { ...style })
    this.#shadowBox(cx - r, cy - r, cx + r, cy + r, style)
  }

  shadowPath2D(path: Path2D, style: GfxShadowStyle): void {
    this.#rec(Op.shadowPath2D, path, { ...style })
    this.#unbounded()
  }

  drawImage(
    img: CanvasImageSource,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    opts?: GfxImageOptions,
  ): void {
    this.#rec(Op.drawImage, img, dx, dy, dw, dh, opts && { ...opts })
    this.#box(dx, dy, dx + dw, dy + dh)
  }

  /**
   * Text is drawn at the scale the node is drawn at, so the picture records the
   * call and the label is rasterized at replay. The picture is marked scale
   * dependent only for its bounds, which come from the string's measure.
   */
  fillText(text: string, x: number, y: number, style: GfxTextStyle = {}): void {
    this.#rec(Op.fillText, text, x, y, { ...style })
    if (text.length === 0) return
    const m = measureLabel(text, style)
    if (!m) {
      this.#unbounded()
      return
    }
    const align = style.align ?? 'left'
    const baseline = style.baseline ?? 'alphabetic'
    const left =
      align === 'right' || align === 'end'
        ? x - m.advance
        : align === 'center'
          ? x - m.advance / 2
          : x
    let top: number
    if (baseline === 'top' || baseline === 'hanging') top = y
    else if (baseline === 'middle') top = y - (m.ascent + m.descent) / 2
    else if (baseline === 'bottom' || baseline === 'ideographic')
      top = y - m.ascent - m.descent
    else top = y - m.ascent
    this.#box(
      left - TEXT_PAD,
      top - TEXT_PAD,
      left + m.advance + TEXT_PAD,
      top + m.ascent + m.descent + TEXT_PAD,
    )
  }
}

function measureLabel(
  text: string,
  style: GfxTextStyle,
): { advance: number; ascent: number; descent: number } | null {
  try {
    const m = textMetrics(text, style.font ?? '10px sans-serif')
    if (!Number.isFinite(m.advance) || !Number.isFinite(m.ascent)) return null
    return m
  } catch {
    return null
  }
}

function copyPoints(pts: ArrayLike<number>, count: number): Float32Array {
  const out = new Float32Array(count * 2)
  for (let i = 0; i < out.length; i++) out[i] = pts[i]
  return out
}

function snapRadii(radii: Radii): Radii {
  return typeof radii === 'number'
    ? radii
    : (Array.from(radii) as unknown as Radii)
}

function snapFill(fill: Fill): Fill {
  if (typeof fill === 'string') return fill
  return { ...fill, stops: fill.stops.slice() } as Fill
}

function snapStroke(style: CanvasStrokeStyle): CanvasStrokeStyle {
  const out: CanvasStrokeStyle = { ...style }
  if (style.dash) out.dash = style.dash.slice()
  if (typeof style.color !== 'string') out.color = snapFill(style.color)
  if (typeof style.width !== 'number') out.width = { ...style.width }
  return out
}

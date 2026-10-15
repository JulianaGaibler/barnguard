import { Node2D } from '../scene/Node2D'
import { hitTestCircle } from '../scene/hitTest'
import { definePaintProps } from '../render/picture/paintProps'
import type { Canvas } from '../render/picture/Canvas'
import type { CanvasStrokeStyle } from '../render/picture/Picture'
import type { Rect } from '../math/Rect'
import type { GfxFill, GfxShadowStyle } from '../render/gfx/Gfx2D'
import type { StrokeAlign } from '../render/gfx/strokeOutline'
import type { RoundRectRadii } from '../render/gfx/roundRectRadii'
import { ellipseDistance } from '../render/gfx/ellipse'
import type { BoxConstraints, Size } from '../layout/constraints'
import type { Measurable } from '../layout/LayoutNode'

/** Reused scratch for the 4-corner rect-stroke polyline (paint is synchronous). */
const RECT_STROKE_SCRATCH = new Float32Array(8)

/** Local-space extent of a {@link ShapeNode}: a circle or a rect. */
export type ShapeGeometry =
  | {
      kind: 'circle'
      /** Radius in world units. */
      radius: number
    }
  | {
      kind: 'ellipse'
      /** Horizontal radius in world units. */
      radiusX: number
      /** Vertical radius in world units. */
      radiusY: number
    }
  | {
      kind: 'rect'
      /** Width in world units. */
      width: number
      /** Height in world units. */
      height: number
      /** Center-origin by default. Set `false` to use top-left origin. */
      centered?: boolean
      /**
       * Corner radii (world units), CSS `border-radius` shorthand. Omit for
       * sharp corners. A radius ≥ half the shorter side gives a capsule.
       */
      radii?: RoundRectRadii
      /**
       * Figma's corner smoothing, from 0 for circular corners (the default) to
       *
       * 1. `IOS_CORNER_SMOOTHING` (0.6) matches the iOS app icon shape. Needs
       *    `radii`.
       */
      smoothing?: number
    }

/** Constructor options for {@link ShapeNode}. */
export interface ShapeNodeOptions {
  id?: string
  geometry: ShapeGeometry
  /** Fill: a CSS color or a gradient paint. Omit to leave unfilled. */
  fill?: GfxFill
  /** Border: a CSS color or a gradient paint. Omit to leave unstroked. */
  stroke?: GfxFill
  /** Stroke width in `strokeSpace` units. Default 1. */
  lineWidth?: number
  /**
   * Border position relative to the shape. Default `'center'`. A non-center
   * value tessellates the border into a filled outline instead of using the
   * shape's analytic SDF; see the drawing guide's border section for what that
   * costs and what it buys (exact joins, no overlap, gradient colors).
   */
  lineAlign?: StrokeAlign
  /**
   * Corner style, outline border only (`lineAlign !== 'center'` or
   * `exactJoins`). Default `'miter'`.
   */
  lineJoin?: CanvasLineJoin
  /** Cap style, outline border only. Default `'round'`. */
  lineCap?: CanvasLineCap
  /**
   * Miter length limit, outline border only. Default 4 (SVG's
   * `stroke-miterlimit`).
   */
  miterLimit?: number
  /**
   * Opt into the outline tessellator for a centered border on the plain
   * (non-rounded) rect shape, for exact joins and caps instead of the segment
   * stroker's round caps and join-free corners. Ignored on a rounded rect or
   * circle, whose analytic border is already exact.
   */
  exactJoins?: boolean
  /**
   * `'screen'` (default), `lineWidth` is a CSS-pixel value that stays visually
   * constant across camera zoom. Opt into `'world'` for a stroke whose
   * thickness scales with the camera (map-anchored decoration).
   */
  strokeSpace?: 'screen' | 'world'
  /**
   * One or more drop shadows, drawn analytically (no render target). A list
   * draws in order, so the first entry sits deepest. Offsets, blur, and spread
   * follow `strokeSpace`, same as `lineWidth`.
   */
  shadow?: GfxShadowStyle | readonly GfxShadowStyle[]
}

const EMPTY_SHADOWS: readonly GfxShadowStyle[] = []

/**
 * Draws a filled and/or stroked circle or rect, with an optional drop shadow.
 * The node's `Transform2D` places it in the world. {@link ShapeGeometry} gives
 * the local-space extent. A circle centers on the node origin, a rect centers
 * by default (set `centered: false` for a top-left origin). Circles hit-test
 * exactly. Rects fall back to the AABB check.
 *
 * Draw order matches CSS: outset shadows, fill, inset shadows, border.
 *
 * @example
 *   const card = new ShapeNode({
 *     geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
 *     fill: {
 *       kind: 'linear',
 *       x0: 0,
 *       y0: 0,
 *       x1: 0,
 *       y1: 140,
 *       stops: BRAND_RAMP,
 *     },
 *     stroke: '#1d1d2b',
 *     lineWidth: 3,
 *     lineAlign: 'outside',
 *     shadow: { color: 'rgba(20,16,40,0.35)', offsetY: 8, blur: 32 },
 *   })
 *   card.transform.x = 200
 *   scene.root.add(card)
 */
export class ShapeNode extends Node2D implements Measurable {
  // Live mirrors of ShapeNodeOptions, documented there. Each is a paint
  // property: writing a new value repaints the node, and a tween can drive the
  // numeric ones. Replace `geometry` or `shadow` with a new object to change
  // them, because changing one in place is not seen.
  declare geometry: ShapeGeometry
  declare fill: GfxFill | null
  declare stroke: GfxFill | null
  declare lineWidth: number
  declare lineAlign: StrokeAlign
  declare lineJoin: CanvasLineJoin | undefined
  declare lineCap: CanvasLineCap | undefined
  declare miterLimit: number | undefined
  declare exactJoins: boolean
  declare strokeSpace: 'screen' | 'world'
  declare shadow: GfxShadowStyle | readonly GfxShadowStyle[] | null
  /** Preallocated size for layout. See {@link ShapeNode.measure}. */
  readonly measuredSize: Size = { w: 0, h: 0 }

  constructor(opts: ShapeNodeOptions) {
    super(opts.id)
    definePaintProps(this, {
      geometry: opts.geometry,
      fill: (opts.fill ?? null) as GfxFill | null,
      stroke: (opts.stroke ?? null) as GfxFill | null,
      lineWidth: opts.lineWidth ?? 1,
      lineAlign: opts.lineAlign ?? ('center' as StrokeAlign),
      lineJoin: opts.lineJoin as CanvasLineJoin | undefined,
      lineCap: opts.lineCap as CanvasLineCap | undefined,
      miterLimit: opts.miterLimit as number | undefined,
      exactJoins: opts.exactJoins ?? false,
      strokeSpace: opts.strokeSpace ?? ('screen' as 'screen' | 'world'),
      shadow: (opts.shadow ?? null) as
        GfxShadowStyle | readonly GfxShadowStyle[] | null,
    })
  }

  /** Holds a single shadow so `#shadowList` can return it without allocating. */
  #oneShadow: GfxShadowStyle[] | null = null

  #shadowList(): readonly GfxShadowStyle[] {
    const shadow = this.shadow
    if (!shadow) return EMPTY_SHADOWS
    if (Array.isArray(shadow)) return shadow as readonly GfxShadowStyle[]
    const one = (this.#oneShadow ??= [shadow as GfxShadowStyle])
    one[0] = shadow as GfxShadowStyle
    return one
  }

  /**
   * Circle- and ellipse-accurate hit-test (distance to the outline ≤ slop in
   * local coords). Rectangles test the local AABB of the geometry, exact for
   * non-rotated rects and a slightly loose but safe superset for rotated ones.
   */
  override hitTest(
    worldX: number,
    worldY: number,
    touchSlopWorld: number,
  ): boolean {
    const g = this.geometry
    if (g.kind === 'circle') {
      return hitTestCircle(this, worldX, worldY, g.radius, touchSlopWorld)
    }
    if (g.kind === 'ellipse') {
      const p = this.worldToLocal(worldX, worldY)
      return (
        ellipseDistance(p.x, p.y, g.radiusX, g.radiusY)[0] <= touchSlopWorld
      )
    }
    const b = this.localBounds
    const p = this.worldToLocal(worldX, worldY)
    return (
      p.x >= b.x - touchSlopWorld &&
      p.x <= b.x + b.width + touchSlopWorld &&
      p.y >= b.y - touchSlopWorld &&
      p.y <= b.y + b.height + touchSlopWorld
    )
  }

  /** The local AABB of the geometry, without borders or shadows. */
  get localBounds(): Rect {
    const g = this.geometry
    if (g.kind === 'circle') {
      const r = g.radius
      return { x: -r, y: -r, width: 2 * r, height: 2 * r }
    }
    if (g.kind === 'ellipse') {
      return {
        x: -g.radiusX,
        y: -g.radiusY,
        width: 2 * g.radiusX,
        height: 2 * g.radiusY,
      }
    }
    return g.centered !== false
      ? { x: -g.width / 2, y: -g.height / 2, width: g.width, height: g.height }
      : { x: 0, y: 0, width: g.width, height: g.height }
  }

  /**
   * Report the shape's intrinsic size (a circle's diameter, an ellipse's two
   * diameters, a rect's `width` × `height`), clamped to `constraints`.
   * Implementing {@link Measurable} lets a ShapeNode sit directly in a `Row`,
   * `Column`, or `Box` without a wrapper.
   */
  measure(constraints: BoxConstraints): Size {
    const { width: w, height: h } = this.localBounds
    this.measuredSize.w = constraints.constrainW(w)
    this.measuredSize.h = constraints.constrainH(h)
    return this.measuredSize
  }

  /**
   * Position the shape within the box its parent assigned. A circle and a
   * centered rect place their origin at the box center. A top-left rect places
   * it at the corner. The geometry is unchanged: a shape keeps its intrinsic
   * size rather than stretching to fill.
   */
  arrange(x: number, y: number, w: number, h: number): void {
    const g = this.geometry
    const centered = g.kind !== 'rect' || g.centered !== false
    this.transform.x = centered ? x + w / 2 : x
    this.transform.y = centered ? y + h / 2 : y
  }

  override paint(gfx: Canvas): void {
    const g = this.geometry
    const shadows = this.#shadowList()
    // Shadow lengths are not screen-aware, so a node with a shadow in screen
    // space reads the screen scale, and repaints when it changes.
    const s =
      shadows.length > 0 && this.strokeSpace !== 'world' ? gfx.screenScale() : 1
    // CSS paint order is background, inset shadow, border: an inset shadow
    // must land between the fill and the stroke, so the two can't share one
    // record (and its double-blend-avoiding composite) whenever one exists.
    const hasInset = shadows.some((sh) => sh.inset === true)

    if (g.kind === 'ellipse') {
      this.#paintEllipse(gfx, g.radiusX, g.radiusY, shadows, s, hasInset)
      return
    }

    if (g.kind === 'circle') {
      for (const sh of shadows) {
        if (!sh.inset)
          gfx.shadowCircle(0, 0, g.radius, this.#scaleShadow(sh, s))
      }
      if (hasInset) {
        if (this.fill) gfx.fillCircle(0, 0, g.radius, this.fill)
        for (const sh of shadows) {
          if (sh.inset)
            gfx.shadowCircle(0, 0, g.radius, this.#scaleShadow(sh, s))
        }
        if (this.stroke) gfx.strokeCircle(0, 0, g.radius, this.#strokeStyle())
      } else {
        this.#drawCircleFillAndStroke(gfx, g.radius)
      }
      return
    }

    // rect
    const centered = g.centered !== false
    const x = centered ? -g.width / 2 : 0
    const y = centered ? -g.height / 2 : 0
    const hasRadii = g.radii !== undefined
    const radii = hasRadii ? g.radii! : 0
    const smoothing = g.smoothing ?? 0

    for (const sh of shadows) {
      if (sh.inset) continue
      gfx.shadowRoundRect(
        x,
        y,
        g.width,
        g.height,
        radii,
        this.#scaleShadow(sh, s),
        smoothing,
      )
    }

    if (hasInset) {
      if (this.fill)
        gfx.fillRoundRect(x, y, g.width, g.height, radii, this.fill, smoothing)
      for (const sh of shadows) {
        if (sh.inset) {
          gfx.shadowRoundRect(
            x,
            y,
            g.width,
            g.height,
            radii,
            this.#scaleShadow(sh, s),
            smoothing,
          )
        }
      }
      if (this.stroke) {
        if (hasRadii) {
          gfx.strokeRoundRect(
            x,
            y,
            g.width,
            g.height,
            radii,
            this.#strokeStyle(),
            smoothing,
          )
        } else {
          this.#strokePlainRect(gfx, x, y, g.width, g.height)
        }
      }
    } else if (hasRadii) {
      this.#drawRoundRectFillAndStroke(
        gfx,
        x,
        y,
        g.width,
        g.height,
        g.radii!,
        smoothing,
      )
    } else {
      this.#drawPlainRectFillAndStroke(gfx, x, y, g.width, g.height)
    }
  }

  /** `style`'s `strokeSpace`-relative lengths, scaled to local units by `s`. */
  #scaleShadow(style: GfxShadowStyle, s: number): GfxShadowStyle {
    if (s === 1) return style
    return {
      ...style,
      offsetX: (style.offsetX ?? 0) * s,
      offsetY: (style.offsetY ?? 0) * s,
      blur: (style.blur ?? 0) * s,
      spread: (style.spread ?? 0) * s,
    }
  }

  /** A screen-space width resolves at replay, so it needs no camera read. */
  #strokeStyle(): CanvasStrokeStyle {
    return {
      color: this.stroke as GfxFill,
      width:
        this.strokeSpace === 'world'
          ? this.lineWidth
          : { screen: this.lineWidth },
      align: this.lineAlign,
      join: this.lineJoin,
      cap: this.lineCap,
      miterLimit: this.miterLimit,
      exactJoins: this.exactJoins,
    }
  }

  /**
   * An ellipse in CSS paint order, as for the other kinds. The analytic shadow
   * has no ellipse, so an ellipse's shadow is the capsule-cornered box around
   * it, the same for a circle and closest for a nearly round ellipse.
   */
  #paintEllipse(
    gfx: Canvas,
    rx: number,
    ry: number,
    shadows: readonly GfxShadowStyle[],
    s: number,
    hasInset: boolean,
  ): void {
    const shadowBox = (sh: GfxShadowStyle) =>
      gfx.shadowRoundRect(
        -rx,
        -ry,
        rx * 2,
        ry * 2,
        Math.min(rx, ry),
        this.#scaleShadow(sh, s),
      )
    for (const sh of shadows) if (!sh.inset) shadowBox(sh)
    if (hasInset) {
      if (this.fill) gfx.fillEllipse(0, 0, rx, ry, this.fill)
      for (const sh of shadows) if (sh.inset) shadowBox(sh)
      if (this.stroke) gfx.strokeEllipse(0, 0, rx, ry, this.#strokeStyle())
      return
    }
    if (this.fill && this.stroke) {
      gfx.fillAndStrokeEllipse(0, 0, rx, ry, this.fill, this.#strokeStyle())
      return
    }
    if (this.fill) gfx.fillEllipse(0, 0, rx, ry, this.fill)
    if (this.stroke) gfx.strokeEllipse(0, 0, rx, ry, this.#strokeStyle())
  }

  #drawCircleFillAndStroke(gfx: Canvas, radius: number): void {
    if (this.fill && this.stroke) {
      gfx.fillAndStrokeCircle(0, 0, radius, this.fill, this.#strokeStyle())
      return
    }
    if (this.fill) gfx.fillCircle(0, 0, radius, this.fill)
    if (this.stroke) gfx.strokeCircle(0, 0, radius, this.#strokeStyle())
  }

  #drawRoundRectFillAndStroke(
    gfx: Canvas,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    smoothing: number,
  ): void {
    if (this.fill && this.stroke) {
      gfx.fillAndStrokeRoundRect(
        x,
        y,
        w,
        h,
        radii,
        this.fill,
        this.#strokeStyle(),
        smoothing,
      )
      return
    }
    if (this.fill) gfx.fillRoundRect(x, y, w, h, radii, this.fill, smoothing)
    if (this.stroke) {
      gfx.strokeRoundRect(x, y, w, h, radii, this.#strokeStyle(), smoothing)
    }
  }

  #drawPlainRectFillAndStroke(
    gfx: Canvas,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    if (this.fill) gfx.fillRect(x, y, w, h, this.fill)
    if (this.stroke) this.#strokePlainRect(gfx, x, y, w, h)
  }

  #strokePlainRect(
    gfx: Canvas,
    x: number,
    y: number,
    w: number,
    h: number,
  ): void {
    const p = RECT_STROKE_SCRATCH
    p[0] = x
    p[1] = y
    p[2] = x + w
    p[3] = y
    p[4] = x + w
    p[5] = y + h
    p[6] = x
    p[7] = y + h
    gfx.strokePolyline(p, 4, { ...this.#strokeStyle(), closed: true })
  }
}

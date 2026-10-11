import { Node2D } from '../scene/Node2D'
import { hitTestCircle } from '../scene/hitTest'
import type { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import type {
  Gfx2D,
  GfxFill,
  GfxShadowStyle,
  GfxStrokeStyle,
} from '../render/gfx/Gfx2D'
import type { StrokeAlign } from '../render/gfx/strokeOutline'
import type { RoundRectRadii } from '../render/gfx/roundRectRadii'
import type { BoxConstraints, Size } from '../layout/constraints'
import type { Measurable } from '../layout/LayoutNode'

/** Reused scratch for the 4-corner rect-stroke polyline (draw is synchronous). */
const RECT_STROKE_SCRATCH = new Float32Array(8)

/** Local-space extent of a {@link ShapeNode}: a circle or a rect. */
export type ShapeGeometry =
  | {
      kind: 'circle'
      /** Radius in world units. */
      radius: number
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
   * shape's analytic SDF; see the drawing guide's border section for what
   * that costs and what it buys (exact joins, no overlap, gradient colors).
   */
  lineAlign?: StrokeAlign
  /** Corner style, outline border only (`lineAlign !== 'center'` or `exactJoins`). Default `'miter'`. */
  lineJoin?: CanvasLineJoin
  /** Cap style, outline border only. Default `'round'`. */
  lineCap?: CanvasLineCap
  /** Miter length limit, outline border only. Default 4 (SVG's `stroke-miterlimit`). */
  miterLimit?: number
  /**
   * Opt into the outline tessellator for a centered border on the plain
   * (non-rounded) rect shape, for exact joins and caps instead of the
   * segment stroker's round caps and join-free corners. Ignored on a
   * rounded rect or circle, whose analytic border is already exact.
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
   * draws in order, so the first entry sits deepest. Offsets, blur, and
   * spread follow `strokeSpace`, same as `lineWidth`.
   */
  shadow?: GfxShadowStyle | readonly GfxShadowStyle[]
}

const EMPTY_SHADOWS: readonly GfxShadowStyle[] = []

/**
 * Draws a filled and/or stroked circle or rect, with an optional drop
 * shadow. The node's `Transform2D` places it in the world. {@link
 * ShapeGeometry} gives the local-space extent. A circle centers on the node
 * origin, a rect centers by default (set `centered: false` for a top-left
 * origin). Circles hit-test exactly. Rects fall back to the AABB check.
 *
 * Draw order matches CSS: outset shadows, fill, inset shadows, border.
 *
 * @example
 *   const card = new ShapeNode({
 *     geometry: { kind: 'rect', width: 240, height: 140, radii: 16 },
 *     fill: { kind: 'linear', x0: 0, y0: 0, x1: 0, y1: 140, stops: BRAND_RAMP },
 *     stroke: '#1d1d2b',
 *     lineWidth: 3,
 *     lineAlign: 'outside',
 *     shadow: { color: 'rgba(20,16,40,0.35)', offsetY: 8, blur: 32 },
 *   })
 *   card.transform.x = 200
 *   scene.root.add(card)
 */
export class ShapeNode extends Node2D implements Measurable {
  // Live mirrors of ShapeNodeOptions, documented there. `debugBounds` is
  // derived from `geometry` in the constructor only, so replacing `geometry`
  // afterwards leaves the bounds behind and the node culls and hit-tests
  // against its old extent. Build a new node instead.
  geometry: ShapeGeometry
  fill: GfxFill | null
  stroke: GfxFill | null
  lineWidth: number
  lineAlign: StrokeAlign
  lineJoin?: CanvasLineJoin
  lineCap?: CanvasLineCap
  miterLimit?: number
  exactJoins: boolean
  strokeSpace: 'screen' | 'world'
  shadow: GfxShadowStyle | readonly GfxShadowStyle[] | null
  /** Preallocated size for layout. See {@link ShapeNode.measure}. */
  readonly measuredSize: Size = { w: 0, h: 0 }

  constructor(opts: ShapeNodeOptions) {
    super(opts.id)
    this.geometry = opts.geometry
    this.fill = opts.fill ?? null
    this.stroke = opts.stroke ?? null
    this.lineWidth = opts.lineWidth ?? 1
    this.lineAlign = opts.lineAlign ?? 'center'
    this.lineJoin = opts.lineJoin
    this.lineCap = opts.lineCap
    this.miterLimit = opts.miterLimit
    this.exactJoins = opts.exactJoins ?? false
    this.strokeSpace = opts.strokeSpace ?? 'screen'
    this.shadow = opts.shadow ?? null
    this.#recomputeDebugBounds()
  }

  #recomputeDebugBounds(): void {
    switch (this.geometry.kind) {
      case 'circle': {
        const r = this.geometry.radius
        this.debugBounds = { x: -r, y: -r, width: 2 * r, height: 2 * r }
        break
      }
      case 'rect': {
        const w = this.geometry.width
        const h = this.geometry.height
        const centered = this.geometry.centered !== false
        this.debugBounds = centered
          ? { x: -w / 2, y: -h / 2, width: w, height: h }
          : { x: 0, y: 0, width: w, height: h }
        break
      }
    }
  }

  /**
   * How far outside `debugBounds` this node can paint: an outside-aligned
   * border, or an outset shadow's own offset/blur/spread. In the same
   * `strokeSpace`-relative units as `lineWidth`; `StageLayerRenderer`
   * applies the same screen/world conversion to it. Inset shadows never
   * extend past the shape, so they don't contribute.
   */
  get cullMargin(): number {
    let m = this.lineAlign === 'outside' ? this.lineWidth : 0
    for (const sh of this.#shadowList()) {
      if (sh.inset) continue
      const offset = Math.hypot(sh.offsetX ?? 0, sh.offsetY ?? 0)
      const sigma = (sh.blur ?? 0) * 0.5
      const extent = offset + 3 * sigma + Math.max(0, sh.spread ?? 0)
      if (extent > m) m = extent
    }
    return m
  }

  #shadowList(): readonly GfxShadowStyle[] {
    const shadow = this.shadow
    if (!shadow) return EMPTY_SHADOWS
    if (Array.isArray(shadow)) return shadow as readonly GfxShadowStyle[]
    return [shadow as GfxShadowStyle]
  }

  /**
   * Circle-accurate hit-test (distance ≤ radius+slop in local coords).
   * Rectangles fall through to the base class's AABB check via `debugBounds`,
   * exact for non-rotated rects and a slightly loose but safe superset for
   * rotated ones.
   */
  override hitTest(
    worldX: number,
    worldY: number,
    touchSlopWorld: number,
  ): boolean {
    if (this.geometry.kind !== 'circle') {
      return super.hitTest(worldX, worldY, touchSlopWorld)
    }
    return hitTestCircle(
      this,
      worldX,
      worldY,
      this.geometry.radius,
      touchSlopWorld,
    )
  }

  /** Expose the current geometry-derived local AABB for downstream code. */
  get localBounds(): Rect | null {
    return this.debugBounds
  }

  /**
   * Report the shape's intrinsic size (a circle's diameter, a rect's `width` ×
   * `height`), clamped to `constraints`. Implementing {@link Measurable} lets a
   * ShapeNode sit directly in a `Row`, `Column`, or `Box` without a wrapper.
   */
  measure(constraints: BoxConstraints): Size {
    const g = this.geometry
    const w = g.kind === 'circle' ? g.radius * 2 : g.width
    const h = g.kind === 'circle' ? g.radius * 2 : g.height
    this.measuredSize.w = constraints.constrainW(w)
    this.measuredSize.h = constraints.constrainH(h)
    return this.measuredSize
  }

  /**
   * Position the shape within the box its parent assigned. A circle and a
   * centered rect place their origin at the box center. A top-left rect places
   * it at the corner. The geometry and `debugBounds` are unchanged: a shape
   * keeps its intrinsic size rather than stretching to fill.
   */
  arrange(x: number, y: number, w: number, h: number): void {
    const g = this.geometry
    const centered = g.kind === 'circle' || g.centered !== false
    this.transform.x = centered ? x + w / 2 : x
    this.transform.y = centered ? y + h / 2 : y
  }

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    const g = this.geometry
    const s = this.strokeSpace === 'world' ? 1 : camera.strokeSpaceScale()
    const shadows = this.#shadowList()
    // CSS paint order is background, inset shadow, border: an inset shadow
    // must land between the fill and the stroke, so the two can't share one
    // record (and its double-blend-avoiding composite) whenever one exists.
    const hasInset = shadows.some((sh) => sh.inset === true)

    if (g.kind === 'circle') {
      for (const sh of shadows) {
        if (!sh.inset) gfx.shadowCircle(0, 0, g.radius, this.#scaleShadow(sh, s))
      }
      if (hasInset) {
        if (this.fill) gfx.fillCircle(0, 0, g.radius, this.fill)
        for (const sh of shadows) {
          if (sh.inset) gfx.shadowCircle(0, 0, g.radius, this.#scaleShadow(sh, s))
        }
        if (this.stroke) gfx.strokeCircle(0, 0, g.radius, this.#strokeStyle(s))
      } else {
        this.#drawCircleFillAndStroke(gfx, g.radius, s)
      }
      return
    }

    // rect
    const centered = g.centered !== false
    const x = centered ? -g.width / 2 : 0
    const y = centered ? -g.height / 2 : 0
    const hasRadii = g.radii !== undefined
    const radii = hasRadii ? g.radii! : 0

    for (const sh of shadows) {
      if (sh.inset) continue
      gfx.shadowRoundRect(x, y, g.width, g.height, radii, this.#scaleShadow(sh, s))
    }

    if (hasInset) {
      if (this.fill) gfx.fillRoundRect(x, y, g.width, g.height, radii, this.fill)
      for (const sh of shadows) {
        if (sh.inset) {
          gfx.shadowRoundRect(x, y, g.width, g.height, radii, this.#scaleShadow(sh, s))
        }
      }
      if (this.stroke) {
        if (hasRadii) {
          gfx.strokeRoundRect(x, y, g.width, g.height, radii, this.#strokeStyle(s))
        } else {
          this.#strokePlainRect(gfx, x, y, g.width, g.height, s)
        }
      }
    } else if (hasRadii) {
      this.#drawRoundRectFillAndStroke(gfx, x, y, g.width, g.height, g.radii!, s)
    } else {
      this.#drawPlainRectFillAndStroke(gfx, x, y, g.width, g.height, s)
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

  #strokeStyle(s: number): GfxStrokeStyle {
    return {
      color: this.stroke as GfxFill,
      width: this.lineWidth * s,
      align: this.lineAlign,
      join: this.lineJoin,
      cap: this.lineCap,
      miterLimit: this.miterLimit,
      exactJoins: this.exactJoins,
    }
  }

  #drawCircleFillAndStroke(gfx: Gfx2D, radius: number, s: number): void {
    if (this.fill && this.stroke) {
      gfx.fillAndStrokeCircle(0, 0, radius, this.fill, this.#strokeStyle(s))
      return
    }
    if (this.fill) gfx.fillCircle(0, 0, radius, this.fill)
    if (this.stroke) gfx.strokeCircle(0, 0, radius, this.#strokeStyle(s))
  }

  #drawRoundRectFillAndStroke(
    gfx: Gfx2D,
    x: number,
    y: number,
    w: number,
    h: number,
    radii: RoundRectRadii,
    s: number,
  ): void {
    if (this.fill && this.stroke) {
      gfx.fillAndStrokeRoundRect(x, y, w, h, radii, this.fill, this.#strokeStyle(s))
      return
    }
    if (this.fill) gfx.fillRoundRect(x, y, w, h, radii, this.fill)
    if (this.stroke) gfx.strokeRoundRect(x, y, w, h, radii, this.#strokeStyle(s))
  }

  #drawPlainRectFillAndStroke(
    gfx: Gfx2D,
    x: number,
    y: number,
    w: number,
    h: number,
    s: number,
  ): void {
    if (this.fill) gfx.fillRect(x, y, w, h, this.fill)
    if (this.stroke) this.#strokePlainRect(gfx, x, y, w, h, s)
  }

  #strokePlainRect(
    gfx: Gfx2D,
    x: number,
    y: number,
    w: number,
    h: number,
    s: number,
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
    gfx.strokePolyline(p, 4, { ...this.#strokeStyle(s), closed: true })
  }
}

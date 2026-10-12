import { Node2D } from '../scene/Node2D'
import type { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import type {
  Gfx2D,
  GfxFill,
  GfxShadowStyle,
  GfxStrokeStyle,
} from '../render/gfx/Gfx2D'
import type { StrokeAlign } from '../render/gfx/strokeOutline'

/**
 * Hit-testing strategy for a {@link Path2DNode}. See the `hitMode` field on
 * {@link Path2DNodeOptions} for what each value tests.
 */
export type Path2DHitMode = 'none' | 'fill' | 'stroke' | 'circle'

/** Constructor options for {@link Path2DNode}. */
export interface Path2DNodeOptions {
  id?: string
  /** The path to draw, in the node's local coord frame. */
  path: Path2D
  /** Fill: a CSS color or a gradient paint. Omit to leave unfilled. */
  fill?: GfxFill
  /** Border: a CSS color or a gradient paint. Omit to leave unstroked. */
  stroke?: GfxFill
  /** Stroke width in `strokeSpace` units. Default 1. */
  lineWidth?: number
  /**
   * Border position relative to the path. Default `'center'`. Needs a closed
   * path with a well-defined winding, see
   * {@link import('../render/gfx/Gfx2D').GfxStrokeStyle.align}.
   */
  lineAlign?: StrokeAlign
  /**
   * Corner style. Default `'miter'`. Only the outline path honours this: see
   * `lineAlign`.
   */
  lineJoin?: CanvasLineJoin
  /** Cap style. Default `'round'` on the outline path. */
  lineCap?: CanvasLineCap
  /** Miter length limit. Default 4 (SVG's `stroke-miterlimit`). */
  miterLimit?: number
  /**
   * Opt into the outline tessellator for a centered border, for exact joins and
   * caps instead of the segment stroker's.
   */
  exactJoins?: boolean
  /**
   * `'screen'` (default), `lineWidth` is a CSS-pixel value that stays visually
   * constant across camera zoom. Opt into `'world'` for a stroke whose
   * thickness scales with the camera.
   */
  strokeSpace?: 'screen' | 'world'
  /**
   * One or more drop shadows, from a cached blurred-coverage mask (see the
   * path-shadows guide for the bake, its one-frame latency, and what stays free
   * to animate). A list draws in order, so the first entry sits deepest.
   * Offsets, blur, and spread follow `strokeSpace`, same as `lineWidth`. Use
   * `'world'` for a shadow on a node the camera zooms, since the cache keys
   * masks on the blur in local units and a `'screen'` radius re-keys them at
   * every camera scale.
   *
   * While the mask is cold (the frame it first appears, or while the bake
   * budget is exhausted) the cache stands in another of this path's masks
   * within half an octave of blur. With none to stand in, an outset shadow
   * falls back to the path's own fill translated by the offset and unblurred,
   * which is also what a blur below the hard-shadow threshold draws, and an
   * inset shadow is skipped.
   */
  shadow?: GfxShadowStyle | readonly GfxShadowStyle[]
  /**
   * Hit-testing strategy (world coords → boolean). `'none'` never hits
   * (default). `'fill'` uses `ctx.isPointInPath` with the even-odd rule (exact
   * interior test, a hole excluded from the fill is excluded here too).
   * `'stroke'` uses `ctx.isPointInStroke` (exact edge test). `'circle'` tests
   * `worldX²+worldY² ≤ (hitRadiusWorld + touchSlopWorld)²`, cheap and good for
   * round targets and UI-scale hitboxes.
   */
  hitMode?: Path2DHitMode
  /** For 'circle' hit-mode. World units. */
  hitRadiusWorld?: number
  /**
   * Precomputed AABB in _local_ coords (i.e. the path's own coord frame). Used
   * both for the debug overlay AABB and for coarse hit-test rejection.
   */
  debugBounds?: Rect
}

const EMPTY_SHADOWS: readonly GfxShadowStyle[] = []

/**
 * Draws a `Path2D` (filled and/or stroked), with an optional drop shadow, and
 * hit-tests points against it. Build the path by hand, or get one from
 * `parseSvgPaths` for SVG artwork. A path needs a registered tessellation
 * before it renders. `parseSvgPaths` registers one for each path it returns, so
 * paths from there draw with no extra setup. A path with no tessellation is
 * skipped and counted in the debug HUD.
 *
 * Hit-testing walks in world coords (what the input pipeline delivers) while
 * the path data is in the node's local coords, so the node inverts its `world`
 * matrix to bring the point into local space before running `isPointInPath` on
 * a shared scratch context. See `hitMode` on {@link Path2DNodeOptions} for the
 * strategies.
 *
 * @example
 *   const { paths } = parseSvgPaths(mapSvg)
 *   for (const [id, entry] of paths) {
 *     const region = new Path2DNode({
 *       id,
 *       path: entry.path,
 *       fill: '#354a6e',
 *       stroke: '#fdf6e3',
 *       lineAlign: 'inside',
 *       hitMode: 'fill',
 *       debugBounds: entry.bounds,
 *     })
 *     scene.root.add(region)
 *   }
 */
export class Path2DNode extends Node2D {
  // Live mirrors of Path2DNodeOptions, documented there.
  path: Path2D
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
  hitMode: Path2DHitMode
  hitRadiusWorld: number

  constructor(opts: Path2DNodeOptions) {
    super(opts.id)
    this.path = opts.path
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
    this.hitMode = opts.hitMode ?? 'none'
    this.hitRadiusWorld = opts.hitRadiusWorld ?? 0
    this.debugBounds = opts.debugBounds ?? null
    if (this.hitMode !== 'none') this.hitEnabled = true
  }

  /**
   * How far outside `debugBounds` this node can paint: an outside-aligned
   * border, or an outset shadow's own offset/blur/spread. Inset shadows never
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

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    const s = this.strokeSpace === 'world' ? 1 : camera.strokeSpaceScale()
    const shadows = this.#shadowList()
    // CSS paint order: outset shadows, fill, inset shadows, border.
    for (const sh of shadows) {
      if (!sh.inset) gfx.shadowPath2D(this.path, this.#scaleShadow(sh, s))
    }
    if (this.fill) gfx.fillPath2D(this.path, this.fill)
    for (const sh of shadows) {
      if (sh.inset) gfx.shadowPath2D(this.path, this.#scaleShadow(sh, s))
    }
    if (this.stroke) gfx.strokePath2D(this.path, this.#strokeStyle(s))
  }

  override hitTest(
    worldX: number,
    worldY: number,
    touchSlopWorld: number,
  ): boolean {
    if (this.hitMode === 'none') return false

    // Transform world → local via the inverse of node.world (2D affine).
    // Uses (a, b, c, d, e, f). Determinant guards against a degenerate node.
    const w = this.transform.world
    const det = w.a * w.d - w.b * w.c
    if (det === 0) return false
    const invDet = 1 / det
    const dx = worldX - w.e
    const dy = worldY - w.f
    const localX = (w.d * dx - w.c * dy) * invDet
    const localY = (-w.b * dx + w.a * dy) * invDet

    if (this.hitMode === 'circle') {
      const r = this.hitRadiusWorld + touchSlopWorld
      return localX * localX + localY * localY <= r * r
    }

    // Coarse AABB reject before the (relatively expensive) path test.
    if (this.debugBounds) {
      const b = this.debugBounds
      const slop = touchSlopWorld
      if (
        localX < b.x - slop ||
        localX > b.x + b.width + slop ||
        localY < b.y - slop ||
        localY > b.y + b.height + slop
      ) {
        return false
      }
    }

    const ctx = getScratchCtx()
    if (this.hitMode === 'stroke') {
      ctx.lineWidth = this.lineWidth
      return ctx.isPointInStroke(this.path, localX, localY)
    }
    // `'evenodd'`, matching `tessellateContours`'s nesting rule, so a hole
    // excluded from the rendered fill is also excluded from hit-testing. The
    // default `'nonzero'` only agrees with that by coincidence, when a hole's
    // subpath happens to wind opposite its container.
    return ctx.isPointInPath(this.path, localX, localY, 'evenodd')
  }
}

// Shared 1×1 scratch context, only ever used for isPointInPath /
// isPointInStroke, which don't touch the canvas pixel buffer.
let scratchCtx: CanvasRenderingContext2D | null = null

function getScratchCtx(): CanvasRenderingContext2D {
  if (scratchCtx) return scratchCtx
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? (new OffscreenCanvas(1, 1) as unknown as HTMLCanvasElement)
      : document.createElement('canvas')
  canvas.width = 1
  canvas.height = 1
  const ctx = (canvas as HTMLCanvasElement).getContext(
    '2d',
  ) as CanvasRenderingContext2D | null
  if (!ctx) throw new Error('Path2DNode: no scratch 2D context available')
  scratchCtx = ctx
  return ctx
}

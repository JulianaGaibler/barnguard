import { SceneNode } from '../scene/SceneNode'
import { hitTestCircle } from '../scene/hitTest'
import type { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import type { Gfx2D } from '../render/gfx/Gfx2D'

/** Reused scratch for the 4-corner rect-stroke polyline (draw is synchronous). */
const RECT_STROKE_SCRATCH = new Float32Array(8)

/**
 * Local-space extent of a {@link ShapeNode}: a circle or a rect.
 *
 * @category Nodes
 */
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
    }

/**
 * Constructor options for {@link ShapeNode}.
 *
 * @category Nodes
 */
export interface ShapeNodeOptions {
  id?: string
  geometry: ShapeGeometry
  /** Fill color (any CSS color). Omit to leave unfilled. */
  fill?: string
  /** Stroke color (any CSS color). Omit to leave unstroked. */
  stroke?: string
  /** Stroke width in `strokeSpace` units. Default 1. */
  lineWidth?: number
  /**
   * `'screen'` (default), `lineWidth` is a CSS-pixel value that stays visually
   * constant across camera zoom. Opt into `'world'` for a stroke whose
   * thickness scales with the camera (map-anchored decoration).
   */
  strokeSpace?: 'screen' | 'world'
}

/**
 * Draws a filled and/or stroked circle or rect. The node's `Transform2D` places
 * it in the world; {@link ShapeGeometry} gives the local-space extent. A circle
 * centers on the node origin, a rect centers by default (set `centered: false`
 * for a top-left origin). Circles hit-test exactly; rects fall back to the AABB
 * check.
 *
 * @category Nodes
 * @example
 *   const dot = new ShapeNode({
 *     geometry: { kind: 'circle', radius: 12 },
 *     fill: '#ffd34d',
 *     stroke: '#000',
 *     lineWidth: 2,
 *   })
 *   dot.transform.x = 200
 *   scene.root.add(dot)
 */
export class ShapeNode extends SceneNode {
  geometry: ShapeGeometry
  fill: string | null
  stroke: string | null
  lineWidth: number
  strokeSpace: 'screen' | 'world'

  constructor(opts: ShapeNodeOptions) {
    super(opts.id)
    this.geometry = opts.geometry
    this.fill = opts.fill ?? null
    this.stroke = opts.stroke ?? null
    this.lineWidth = opts.lineWidth ?? 1
    this.strokeSpace = opts.strokeSpace ?? 'screen'
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
   * Circle-accurate hit-test (distance ≤ radius+slop in local coords).
   * Rectangles fall through to the base class's AABB check via `debugBounds`. *
   * for non-rotated rects that's exact, and for rotated rects a slightly loose
   * but safe superset.
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

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    const g = this.geometry
    if (g.kind === 'circle') {
      if (this.fill) gfx.fillCircle(0, 0, g.radius, this.fill)
      if (this.stroke) {
        const s = this.strokeSpace === 'world' ? 1 : camera.strokeSpaceScale()
        gfx.strokeCircle(0, 0, g.radius, {
          color: this.stroke,
          width: this.lineWidth * s,
        })
      }
      return
    }
    // rect
    const centered = g.centered !== false
    const x = centered ? -g.width / 2 : 0
    const y = centered ? -g.height / 2 : 0
    if (this.fill) gfx.fillRect(x, y, g.width, g.height, this.fill)
    if (this.stroke) {
      const s = this.strokeSpace === 'world' ? 1 : camera.strokeSpaceScale()
      const p = RECT_STROKE_SCRATCH
      p[0] = x
      p[1] = y
      p[2] = x + g.width
      p[3] = y
      p[4] = x + g.width
      p[5] = y + g.height
      p[6] = x
      p[7] = y + g.height
      gfx.strokePolyline(p, 4, {
        color: this.stroke,
        width: this.lineWidth * s,
        closed: true,
      })
    }
  }
}

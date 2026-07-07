import { SceneNode } from '../scene/SceneNode'
import type { Camera } from '../camera/Camera'
import type { Rect } from '../math/Rect'
import type { Gfx2D } from '../render/gfx/Gfx2D'

export type Path2DHitMode = 'none' | 'fill' | 'stroke' | 'circle'

export interface Path2DNodeOptions {
  id?: string
  path: Path2D
  fill?: string
  stroke?: string
  lineWidth?: number
  /**
   * `'screen'` (default), `lineWidth` is a CSS-pixel value that stays visually
   * constant across camera zoom. Opt into `'world'` for a stroke whose
   * thickness scales with the camera.
   */
  strokeSpace?: 'screen' | 'world'
  /**
   * Hit-testing strategy (world coords → boolean): 'none', never a hit
   * (default) 'fill', `ctx.isPointInPath` (exact interior test, right for state
   * selection) 'stroke', `ctx.isPointInStroke` (exact edge test) 'circle',
   * `worldX²+worldY² ≤ (hitRadiusWorld + touchSlopWorld)²` (cheap; right for
   * packets & UI-scale hitboxes)
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

/**
 * A scene node that draws a Path2D and hit-tests points against it.
 *
 * Design note, hit-testing walks in _world_ coords (that's what the input
 * pipeline delivers), but Path2D data is in the node's _local_ coords. We
 * invert the node's 2D-affine `world` matrix to transform the world point into
 * local space, then run `isPointInPath` on a shared scratch context.
 */
export class Path2DNode extends SceneNode {
  path: Path2D
  fill: string | null
  stroke: string | null
  lineWidth: number
  strokeSpace: 'screen' | 'world'
  hitMode: Path2DHitMode
  hitRadiusWorld: number

  constructor(opts: Path2DNodeOptions) {
    super(opts.id)
    this.path = opts.path
    this.fill = opts.fill ?? null
    this.stroke = opts.stroke ?? null
    this.lineWidth = opts.lineWidth ?? 1
    this.strokeSpace = opts.strokeSpace ?? 'screen'
    this.hitMode = opts.hitMode ?? 'none'
    this.hitRadiusWorld = opts.hitRadiusWorld ?? 0
    this.debugBounds = opts.debugBounds ?? null
    if (this.hitMode !== 'none') this.hitEnabled = true
  }

  override draw(gfx: Gfx2D, camera: Camera, _dt: number): void {
    if (this.fill) gfx.fillPath2D(this.path, this.fill)
    if (this.stroke) {
      const s = this.strokeSpace === 'world' ? 1 : camera.strokeSpaceScale()
      gfx.strokePath2D(this.path, {
        color: this.stroke,
        width: this.lineWidth * s,
      })
    }
  }

  override hitTest(
    worldX: number,
    worldY: number,
    touchSlopWorld: number,
  ): boolean {
    if (this.hitMode === 'none') return false

    // Transform world → local via the inverse of node.world (2D affine).
    // Uses (a, b, c, d, e, f); determinant guards against a degenerate node.
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
    return ctx.isPointInPath(this.path, localX, localY)
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

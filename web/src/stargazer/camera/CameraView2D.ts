import type { Vec2 } from '../math/Vec2'
import type { Rect } from '../math/Rect'

/**
 * A 2D affine as the six live components of a `DOMMatrix` (row order `a c e / b
 * d f`). `DOMMatrix` satisfies this shape directly, so world matrices can be
 * read through it without copying.
 *
 * `screenX = a·x + c·y + e`, `screenY = b·x + d·y + f`.
 *
 * @category Camera
 */
export interface Affine2x3 {
  a: number
  b: number
  c: number
  d: number
  e: number
  f: number
}

/**
 * The read-only view surface a 2D camera exposes to everything that isn't the
 * camera itself: node `draw`, input hit-testing, layout, DOM anchoring, and the
 * debug overlays. Decoupling these from the concrete camera class lets a plain
 * `Camera` view-math helper, a `CameraNode2D`, or a debug fly-camera all stand
 * in interchangeably.
 *
 * Every mapping is in CSS pixels; the renderer folds DPR in separately as a
 * baseline factor. {@link CameraView2D.getScreenAffine} is the single CSS-pixel
 * world→screen affine that already incorporates the camera's own world
 * transform, so a translated / scaled / rotated camera projects correctly
 * everywhere that reads it.
 *
 * @category Camera
 */
export interface CameraView2D {
  /** Map a CSS-pixel canvas point to world space. */
  screenToWorld(x: number, y: number, out?: Vec2): Vec2
  /** Map a world-space point to CSS-pixel canvas coordinates. */
  worldToScreen(x: number, y: number, out?: Vec2): Vec2
  /**
   * World-space AABB currently visible on the full canvas. Conservative: it
   * fully encloses the (possibly rotated) view, so callers can cull / fill
   * against it safely.
   */
  visibleWorldRect(out?: Rect): Rect
  /** Uniform screen-CSS-px per world unit for the current view. */
  screenPxPerWorldUnit(): number
  /**
   * Multiplier converting a CSS-pixel stroke width into world units for the
   * current view, so a node's stroke reads at a constant device thickness. See
   * `Camera.strokeSpaceScale`.
   */
  strokeSpaceScale(): number
  /**
   * The full CSS-pixel world→screen affine, including the camera's own world
   * transform. Without `out`, returns a cached object the caller MUST treat as
   * read-only; pass `out` for a private copy.
   */
  getScreenAffine(out?: Affine2x3): Affine2x3
  /** World-space rect the camera frames (its framing viewport). */
  readonly viewport: Rect
  /** Bumps whenever the view mapping changes, for cheap cache-keying. */
  readonly frameNum: number
}

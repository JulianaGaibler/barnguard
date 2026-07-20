/**
 * 2D math primitives shared across the engine. {@link Transform2D} is a
 * decomposed node transform (position, scale, rotation, origin, alpha).
 * {@link Vec2} and {@link Rect} are plain data with `vec2*` / `rect*` helper
 * functions that write into a destination to stay allocation-free. `easings`
 * holds the tween curves, and the `matrix` helpers operate on `DOMMatrix`
 * affines.
 *
 * @module math
 * @category Math
 */
export { Transform2D } from '../math/Transform2D'
export type { Vec2 } from '../math/Vec2'
export {
  vec2,
  vec2Set,
  vec2Copy,
  vec2Add,
  vec2Sub,
  vec2Scale,
  vec2Length,
  vec2Distance,
  vec2DistanceSq,
  vec2Lerp,
  vec2Dot,
  vec2Cross,
  vec2CrossSV,
  vec2Perp,
  vec2Normalize,
  vec2Rotate,
  vec2Negate,
} from '../math/Vec2'
export type { Rect } from '../math/Rect'
export {
  rect,
  rectCopy,
  rectContains,
  rectIntersects,
  rectUnion,
} from '../math/Rect'
export {
  copyMatrix2D,
  multiplyMatrix2D,
  invertMatrix2D,
  transformPoint2D,
} from '../math/matrix'
export { clamp, clampAbs, lerp, lerpAngle } from '../math/scalar'
export type { Easing } from '../math/easings'
export * as easings from '../math/easings'

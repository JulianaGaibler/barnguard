/**
 * Math primitives shared across the engine. {@link Transform2D} /
 * {@link Transform3D} are decomposed node transforms — 2D (position, scale,
 * rotation, origin, alpha) and 3D (position, rotation quaternion, scale,
 * alpha). {@link Vec2} / {@link Vec3} / {@link Rect} / {@link Quat} / {@link Ray}
 * are plain data with `vec2*` / `vec3*` / `rect*` / `quat*` helper functions
 * that write into a destination to stay allocation-free. `easings` holds the
 * tween curves; the `matrix` helpers operate on `DOMMatrix` affines (2D) and
 * {@link Mat4} column-major arrays (3D).
 *
 * @module math
 * @category Math
 */
export { Transform2D } from '../math/Transform2D'
export { Transform3D } from '../math/Transform3D'
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
export type { Vec3 } from '../math/Vec3'
export {
  vec3,
  vec3Set,
  vec3Copy,
  vec3Add,
  vec3Sub,
  vec3Scale,
  vec3Length,
  vec3Distance,
  vec3DistanceSq,
  vec3Lerp,
  vec3Dot,
  vec3Cross,
  vec3Normalize,
  vec3Negate,
} from '../math/Vec3'
export type { Quat } from '../math/Quat'
export {
  quat,
  quatIdentity,
  quatCopy,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  quatSlerp,
} from '../math/Quat'
export type { Ray } from '../math/Ray'
export { ray, rayAt } from '../math/Ray'
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
export type { Mat4 } from '../math/Mat4'
export {
  mat4,
  mat4Identity,
  mat4Copy,
  mat4Multiply,
  mat4Invert,
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Compose,
  mat4TransformPoint,
  mat4TransformDir,
} from '../math/Mat4'
export type { Mat3 } from '../math/Mat3'
export { mat3, mat3NormalMatrix } from '../math/Mat3'
export type { Aabb } from '../math/shadowFit'
export { fitDirectionalOrtho } from '../math/shadowFit'
export { clamp, clampAbs, lerp, lerpAngle } from '../math/scalar'
export type { Easing } from '../math/easings'
export * as easings from '../math/easings'

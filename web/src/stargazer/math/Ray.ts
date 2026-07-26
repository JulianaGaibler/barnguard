import type { Vec3 } from './Vec3'

/**
 * A half-line in 3D: all points `origin + direction * t` for `t >= 0`.
 * `direction` is expected to be unit length so `t` reads as a world-space
 * distance. Produced by `Camera3D.screenToRay` for 3D picking.
 *
 * @category Math
 */
export interface Ray {
  origin: Vec3
  direction: Vec3
}

/**
 * Create a ray. Defaults to the origin pointing down `-z` (the camera-forward
 * convention in the right-handed world).
 *
 * @category Math
 */
export function ray(origin: Vec3 = { x: 0, y: 0, z: 0 }): Ray {
  return { origin, direction: { x: 0, y: 0, z: -1 } }
}

/**
 * Point along `r` at distance `t`, into `dst`.
 *
 * @category Math
 */
export function rayAt(dst: Vec3, r: Readonly<Ray>, t: number): Vec3 {
  dst.x = r.origin.x + r.direction.x * t
  dst.y = r.origin.y + r.direction.y * t
  dst.z = r.origin.z + r.direction.z * t
  return dst
}

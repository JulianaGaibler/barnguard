import {
  type Mat4,
  mat4,
  mat4LookAt,
  mat4Ortho,
  mat4Perspective,
  mat4Multiply,
  mat4TransformPoint,
} from './Mat4'
import { type Vec3, vec3 } from './Vec3'

/**
 * Widest spot cone (half-angle) the shadow frustum supports before
 * `tan(fovY/2)` degenerates.
 */
const MAX_SPOT_HALF_ANGLE = 1.45

/** An axis-aligned box, as returned by `MeshNode.localBounds()`. */
export interface Aabb {
  min: Vec3
  max: Vec3
}

// World units the near plane is pulled toward the light, so casters just behind
// the fitted slab still write into the shadow map.
const NEAR_PULLBACK = 1

/**
 * Orthographic light-space view-projection that covers `aabb` (the shadow
 * casters' combined world bounds) for a directional light whose rays travel
 * along `lightDir`. The x/y extent is a fixed radius (half the AABB diagonal,
 * optionally capped by `maxDistance`); with the box center snapped to the texel
 * grid, the map translates in whole-texel steps as casters move. `texSize` is
 * the shadow map's pixel size.
 *
 * @category Math
 */
export function fitDirectionalOrtho(
  aabb: Aabb,
  lightDir: Vec3,
  texSize: number,
  maxDistance = 0,
): Mat4 {
  // Light view from the origin looking along the light's travel direction.
  // `mat4LookAt` looks down −z, so geometry in front has negative light-space z.
  const up = Math.abs(lightDir.y) > 0.99 ? vec3(0, 0, 1) : vec3(0, 1, 0)
  const view = mat4LookAt(mat4(), vec3(0, 0, 0), lightDir, up)

  let radius =
    0.5 *
    Math.hypot(
      aabb.max.x - aabb.min.x,
      aabb.max.y - aabb.min.y,
      aabb.max.z - aabb.min.z,
    )
  if (radius === 0) radius = 1
  if (maxDistance > 0) radius = Math.min(radius, maxDistance)

  // Light-space z-range from the 8 corners → ortho near/far; the AABB center
  // gives the box center.
  let minZ = Infinity
  let maxZ = -Infinity
  const p = vec3()
  for (let i = 0; i < 8; i++) {
    mat4TransformPoint(
      p,
      view,
      i & 1 ? aabb.max.x : aabb.min.x,
      i & 2 ? aabb.max.y : aabb.min.y,
      i & 4 ? aabb.max.z : aabb.min.z,
    )
    if (p.z < minZ) minZ = p.z
    if (p.z > maxZ) maxZ = p.z
  }
  const center = mat4TransformPoint(
    vec3(),
    view,
    0.5 * (aabb.min.x + aabb.max.x),
    0.5 * (aabb.min.y + aabb.max.y),
    0.5 * (aabb.min.z + aabb.max.z),
  )

  // Snap the box center to the texel grid so the map translates in whole texels.
  const worldPerTexel = (2 * radius) / texSize
  const cx = Math.round(center.x / worldPerTexel) * worldPerTexel
  const cy = Math.round(center.y / worldPerTexel) * worldPerTexel

  // Light-space z is negative in front, so the least-negative corner is nearest.
  const near = -maxZ - NEAR_PULLBACK
  const far = -minZ
  const proj = mat4Ortho(
    mat4(),
    cx - radius,
    cx + radius,
    cy - radius,
    cy + radius,
    near,
    far,
  )
  return mat4Multiply(mat4(), proj, view)
}

/**
 * Perspective light-space view-projection for a spot light at `pos` aimed along
 * `dir`, covering its cone out to `far`. `outerConeAngle` is the cone's
 * half-angle, so the frustum's vertical field of view is twice it (clamped to
 * keep the projection non-degenerate at very wide cones). `texSize` isn't
 * needed — the perspective map isn't texel-snapped.
 *
 * @category Math
 */
export function fitSpotPerspective(
  pos: Vec3,
  dir: Vec3,
  outerConeAngle: number,
  near: number,
  far: number,
): Mat4 {
  const fovY = 2 * Math.min(outerConeAngle, MAX_SPOT_HALF_ANGLE)
  const up = Math.abs(dir.y) > 0.99 ? vec3(0, 0, 1) : vec3(0, 1, 0)
  const center = vec3(pos.x + dir.x, pos.y + dir.y, pos.z + dir.z)
  const view = mat4LookAt(mat4(), pos, center, up)
  const proj = mat4Perspective(mat4(), fovY, 1, near, far)
  return mat4Multiply(mat4(), proj, view)
}

// Look direction and up vector for each cube face, in GL cube-map face order
// (+X, −X, +Y, −Y, +Z, −Z). Off by one and faces sample flipped.
const CUBE_FACES: ReadonlyArray<{ dir: Vec3; up: Vec3 }> = [
  { dir: vec3(1, 0, 0), up: vec3(0, -1, 0) },
  { dir: vec3(-1, 0, 0), up: vec3(0, -1, 0) },
  { dir: vec3(0, 1, 0), up: vec3(0, 0, 1) },
  { dir: vec3(0, -1, 0), up: vec3(0, 0, -1) },
  { dir: vec3(0, 0, 1), up: vec3(0, -1, 0) },
  { dir: vec3(0, 0, -1), up: vec3(0, -1, 0) },
]

/**
 * Perspective view-projection for cube `face` (0..5) of a point light at `pos`.
 * A 90° square frustum per face tiles the full sphere. Pass `far` a little
 * larger than the distance the fragment shader normalizes by, so geometry at
 * that distance isn't clipped before writing depth.
 *
 * @category Math
 */
export function fitPointCubeFace(
  pos: Vec3,
  face: number,
  near: number,
  far: number,
): Mat4 {
  const f = CUBE_FACES[face]
  const center = vec3(pos.x + f.dir.x, pos.y + f.dir.y, pos.z + f.dir.z)
  const view = mat4LookAt(mat4(), pos, center, f.up)
  const proj = mat4Perspective(mat4(), Math.PI / 2, 1, near, far)
  return mat4Multiply(mat4(), proj, view)
}

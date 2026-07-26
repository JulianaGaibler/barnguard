import {
  mat4Invert,
  mat4TransformPoint,
  mat4TransformDir,
  mat4,
} from '../math/Mat4'
import { vec3, type Vec3 } from '../math/Vec3'
import type { Ray } from '../math/Ray'
import { MeshNode } from '../nodes/MeshNode'
import type { Node } from './Node'
import { walkTree } from './traverse'

/**
 * A ray-picking hit against a {@link MeshNode}: the node struck and the world
 * distance along the ray to its bounding box.
 *
 * @category Scene
 */
export interface Raycast3DHit {
  node: MeshNode
  distance: number
}

// Scratch state reused across calls; picking is synchronous.
const INV = mat4()
const LOCAL_ORIGIN: Vec3 = { x: 0, y: 0, z: 0 }
const LOCAL_DIR: Vec3 = { x: 0, y: 0, z: 0 }

/**
 * Distance along `ray` (world space) to `mesh`'s local AABB, or `null` if it
 * misses. The ray is transformed into the mesh's local space and slab-tested
 * against its bounds, so an oriented or scaled node is handled correctly.
 * Bounds-level precision: good for object picking, not per-triangle.
 *
 * @category Scene
 */
export function raycastMesh(ray: Ray, mesh: MeshNode): number | null {
  const bounds = mesh.localBounds()
  if (!bounds) return null
  const world = mesh.worldMatrix
  if (!mat4Invert(INV, world)) return null
  const o = mat4TransformPoint(
    LOCAL_ORIGIN,
    INV,
    ray.origin.x,
    ray.origin.y,
    ray.origin.z,
  )
  const ox = o.x,
    oy = o.y,
    oz = o.z
  const d = mat4TransformDir(
    LOCAL_DIR,
    INV,
    ray.direction.x,
    ray.direction.y,
    ray.direction.z,
  )

  // Slab test in local space.
  let tMin = -Infinity
  let tMax = Infinity
  const lo = [bounds.min.x, bounds.min.y, bounds.min.z]
  const hi = [bounds.max.x, bounds.max.y, bounds.max.z]
  const origin = [ox, oy, oz]
  const dir = [d.x, d.y, d.z]
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dir[i]) < 1e-9) {
      if (origin[i] < lo[i] || origin[i] > hi[i]) return null
    } else {
      const inv = 1 / dir[i]
      let t1 = (lo[i] - origin[i]) * inv
      let t2 = (hi[i] - origin[i]) * inv
      if (t1 > t2) {
        const tmp = t1
        t1 = t2
        t2 = tmp
      }
      if (t1 > tMin) tMin = t1
      if (t2 < tMax) tMax = t2
      if (tMin > tMax) return null
    }
  }
  const tHit = tMin >= 0 ? tMin : tMax
  if (tHit < 0) return null
  // `tHit` is in local units scaled by the (unnormalized) local direction. Scale
  // back to world distance by the local direction length.
  const localDirLen = Math.hypot(d.x, d.y, d.z) || 1
  return tHit * localDirLen
}

/**
 * Nearest {@link MeshNode} in `world` struck by `ray`, or `null`. Skips
 * invisible nodes and meshes without loaded geometry. Pair with
 * `CameraNode3D.screenToRay` for pointer picking in 3D.
 *
 * @category Scene
 * @example
 *   const ray = engine.currentCamera3D.screenToRay(ndcX, ndcY)
 *   const hit = raycastWorld3D(engine.tree, ray)
 *   if (hit) select(hit.node)
 */
export function raycastWorld3D(
  world: { root: Node },
  ray: Ray,
  filter?: (node: MeshNode) => boolean,
): Raycast3DHit | null {
  let best: Raycast3DHit | null = null
  walkTree(world.root, (n: Node) => {
    if (!(n instanceof MeshNode) || !n.visible) return
    if (filter && !filter(n)) return
    const dist = raycastMesh(ray, n)
    if (dist !== null && (best === null || dist < best.distance)) {
      best = { node: n, distance: dist }
    }
  })
  return best
}

/** Reusable scratch ray for callers that pick every frame without allocating. */
export function makeRay(): Ray {
  return { origin: vec3(), direction: vec3() }
}

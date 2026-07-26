import { Node3D } from '../scene/Node3D'
import type { Vec3 } from '../math/Vec3'

/**
 * CPU-side geometry for a {@link MeshNode}: interleaved is avoided in favor of
 * separate position and normal arrays (3 floats each per vertex) plus a triangle
 * index list. Indices are `Uint16Array` for meshes up to 65 535 vertices, or
 * `Uint32Array` for larger ones. The renderer keeps a reference so it can
 * re-upload after a GPU context loss.
 *
 * @category Scene
 */
export interface MeshGeometry {
  /** Vertex positions, xyz per vertex. */
  positions: Float32Array
  /** Vertex normals, xyz per vertex. Length matches `positions`. */
  normals: Float32Array
  /** Triangle indices into the vertex arrays. */
  indices: Uint16Array | Uint32Array
}

/**
 * Surface appearance for a {@link MeshNode}. `lit` shades with the 3D pass's
 * single directional light plus ambient; unlit shows the flat `color`. `color`
 * is straight (non-premultiplied) RGBA in `0..1`.
 *
 * @category Scene
 */
export interface MeshMaterial {
  lit: boolean
  color: [number, number, number, number]
}

/**
 * A drawable 3D node: a {@link MeshGeometry} and a {@link MeshMaterial} placed by
 * a {@link Transform3D}. Add it under a {@link World3D}; the 3D render pass draws
 * every ready mesh, sorted back-to-front, with depth testing.
 *
 * Geometry can be `null` at construction and filled in later (a glTF mesh whose
 * buffers are still downloading); the pass skips a mesh until its geometry is
 * set and uploaded to the GPU.
 *
 * @category Scene
 * @example
 *   const cube = new MeshNode(createBoxGeometry(1), {
 *     lit: true,
 *     color: [0.9, 0.3, 0.2, 1],
 *   })
 *   world3d.add(cube)
 *   cube.transform.setPosition(0, 0, -6)
 */
export class MeshNode extends Node3D {
  geometry: MeshGeometry | null
  material: MeshMaterial

  #boundsMin: Vec3 | null = null
  #boundsMax: Vec3 | null = null
  #boundsFor: MeshGeometry | null = null

  constructor(
    geometry: MeshGeometry | null,
    material: MeshMaterial,
    id?: string,
  ) {
    super(id)
    this.geometry = geometry
    this.material = material
  }

  /**
   * Local-space axis-aligned bounds of the current geometry, or `null` when the
   * geometry hasn't loaded. Recomputed if the geometry reference changes. Used
   * for ray picking (see `raycastWorld3D`).
   */
  localBounds(): { min: Vec3; max: Vec3 } | null {
    const geom = this.geometry
    if (!geom) return null
    if (this.#boundsFor !== geom) {
      const p = geom.positions
      let minX = Infinity, minY = Infinity, minZ = Infinity
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity
      for (let i = 0; i < p.length; i += 3) {
        const x = p[i], y = p[i + 1], z = p[i + 2]
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (z < minZ) minZ = z
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
        if (z > maxZ) maxZ = z
      }
      this.#boundsMin = { x: minX, y: minY, z: minZ }
      this.#boundsMax = { x: maxX, y: maxY, z: maxZ }
      this.#boundsFor = geom
    }
    return { min: this.#boundsMin!, max: this.#boundsMax! }
  }
}

/**
 * Build a unit-ish axis-aligned box centered at the origin, `size` units per
 * edge, with per-face normals (flat shading). Handy for smoke-testing the 3D
 * pass before a real model loads.
 *
 * @category Scene
 */
export function createBoxGeometry(size = 1): MeshGeometry {
  const h = size / 2
  // Six faces, each a quad of four unique vertices so normals stay per-face.
  const faces: Array<{ n: [number, number, number]; v: number[][] }> = [
    { n: [0, 0, 1], v: [[-h, -h, h], [h, -h, h], [h, h, h], [-h, h, h]] },
    { n: [0, 0, -1], v: [[h, -h, -h], [-h, -h, -h], [-h, h, -h], [h, h, -h]] },
    { n: [1, 0, 0], v: [[h, -h, h], [h, -h, -h], [h, h, -h], [h, h, h]] },
    { n: [-1, 0, 0], v: [[-h, -h, -h], [-h, -h, h], [-h, h, h], [-h, h, -h]] },
    { n: [0, 1, 0], v: [[-h, h, h], [h, h, h], [h, h, -h], [-h, h, -h]] },
    { n: [0, -1, 0], v: [[-h, -h, -h], [h, -h, -h], [h, -h, h], [-h, -h, h]] },
  ]
  const positions: number[] = []
  const normals: number[] = []
  const indices: number[] = []
  for (let f = 0; f < faces.length; f++) {
    const { n, v } = faces[f]
    const base = f * 4
    for (const p of v) {
      positions.push(p[0], p[1], p[2])
      normals.push(n[0], n[1], n[2])
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3)
  }
  return {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    indices: new Uint16Array(indices),
  }
}

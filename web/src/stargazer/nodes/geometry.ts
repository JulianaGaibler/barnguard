/**
 * Procedural {@link MeshGeometry} builders for the shapes a scene tends to need
 * before, or instead of, a modelled asset: flat panels, discs and extrusions.
 *
 * @remarks
 *   Two orientation conventions run through this file, chosen to match what each
 *   shape is normally for. Quads lie in the XY plane facing `+Z`, like a sheet
 *   held up to the camera, which is also the orientation the renderer's own
 *   internal quad uses. Discs and prisms stand on the XZ plane with `+Y` up,
 *   like an object set down on the ground. Rotate the node to place either
 *   elsewhere.
 *
 *   Every builder emits positions, normals and UVs, winds triangles
 *   counter-clockwise when seen from the front, and indexes with `Uint16Array`.
 *   None of these shapes approaches the 65 535-vertex limit at any sane segment
 *   count.
 * @example
 *   const card = new MeshNode(
 *     createRoundedQuadGeometry({
 *       width: 0.128,
 *       height: 0.194,
 *       radius: 0.012,
 *     }),
 *     { lit: true, pbr: true, color: [1, 1, 1, 1], baseColorTex: face },
 *   )
 */
import type { MeshGeometry } from './MeshNode'

/** Where a shape's local origin sits relative to its extent. */
export type QuadOrigin = 'center' | 'bottom'

/** A sub-rectangle of a texture, in `0..1` UV space. */
export interface UvRect {
  x: number
  y: number
  width: number
  height: number
}

const FULL_UV: UvRect = { x: 0, y: 0, width: 1, height: 1 }

/** Construction options shared by the flat quad builders. */
export interface QuadOptions {
  width: number
  height: number
  /** Default `'center'`. `'bottom'` puts the origin on the bottom edge. */
  origin?: QuadOrigin
  /** Region of the texture to map across the quad. Default the whole texture. */
  uvRect?: UvRect
}

/** Construction options for {@link createRoundedQuadGeometry}. */
export interface RoundedQuadOptions extends QuadOptions {
  /** Corner radius, clamped to half the shorter side. */
  radius: number
  /** Triangles per corner arc. Default `4`. */
  cornerSegments?: number
}

/** Construction options for {@link createDiscGeometry}. */
export interface DiscOptions {
  radius: number
  /** Default `96`, and the count across `sweepAngle` rather than a whole turn. */
  segments?: number
  /** Inner radius, turning the disc into an annulus. Default `0`. */
  innerRadius?: number
  /**
   * Where the sweep begins, in radians. Default `0`, which is `+X`.
   *
   * Angles run clockwise in the XZ plane so the winding reads counter-clockwise
   * from `+Y`, which means the sweep turns from `+X` toward `-Z`.
   */
  startAngle?: number
  /**
   * How far to sweep, in radians. Default a whole turn, which closes the ring.
   * Anything less leaves it open, giving a pie slice or an arc band.
   */
  sweepAngle?: number
}

/** Construction options for {@link createPrismGeometry}. */
export interface PrismOptions {
  /** Sides around the axis. `3` is a triangular prism, `48` reads as a cylinder. */
  sides: number
  radius: number
  height: number
  /** Radius at the top face, for a taper. Default `radius`. */
  topRadius?: number
  /** Close the two ends. Default `true`. */
  caps?: boolean
  /** Default `'bottom'`, which puts the base on the `y = 0` plane. */
  origin?: QuadOrigin
  /**
   * Shade the side band as a curved surface rather than flat facets. Default
   * `false`.
   *
   * Each side vertex takes the normal pointing out from the axis at its own
   * angle, so shading interpolates across the seams and a high side count reads
   * as a cylinder. Leave it off for a low side count, where the facets are the
   * shape. The caps stay flat either way.
   */
  smooth?: boolean
}

/** A flat rectangle in the XY plane, facing `+Z`. */
export function createQuadGeometry(opts: QuadOptions): MeshGeometry {
  const { width, height } = opts
  const uv = opts.uvRect ?? FULL_UV
  const hw = width / 2
  const y0 = opts.origin === 'bottom' ? 0 : -height / 2
  const y1 = y0 + height

  // V runs opposite Y: textures are authored top-down, the quad is built
  // bottom-up.
  return {
    positions: new Float32Array([-hw, y0, 0, hw, y0, 0, hw, y1, 0, -hw, y1, 0]),
    normals: new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]),
    uvs: new Float32Array([
      uv.x,
      uv.y + uv.height,
      uv.x + uv.width,
      uv.y + uv.height,
      uv.x + uv.width,
      uv.y,
      uv.x,
      uv.y,
    ]),
    indices: new Uint16Array([0, 1, 2, 0, 2, 3]),
  }
}

/**
 * A rectangle with rounded corners in the XY plane, facing `+Z`.
 *
 * The rounding is geometry rather than an alpha cutout, so the silhouette stays
 * clean at any scale and the mesh can sit in the opaque, depth-writing bucket
 * and cast a correctly shaped shadow.
 *
 * Built as a triangle fan from the centre, which is valid because a rounded
 * rectangle is convex.
 */
export function createRoundedQuadGeometry(
  opts: RoundedQuadOptions,
): MeshGeometry {
  const { width, height } = opts
  const uv = opts.uvRect ?? FULL_UV
  const seg = Math.max(1, Math.floor(opts.cornerSegments ?? 4))
  const r = Math.max(0, Math.min(opts.radius, width / 2, height / 2))
  const hw = width / 2
  const hh = height / 2
  const cy = opts.origin === 'bottom' ? hh : 0

  // Corner arc centres, counter-clockwise from the bottom right so the ring
  // comes out wound counter-clockwise seen from +Z.
  const corners: Array<[number, number, number]> = [
    [hw - r, -hh + r, -Math.PI / 2],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
  ]

  // Consecutive duplicates would fan into zero-area triangles. They appear
  // whenever two arcs meet at a point: at radius 0 each arc collapses, and at a
  // fully clamped radius the four arc centres coincide and the ring is a
  // circle. Both are ordinary inputs, so the ring is deduped rather than
  // guarded against.
  const ring: Array<[number, number]> = []
  const pushPoint = (x: number, y: number): void => {
    const prev = ring[ring.length - 1]
    if (prev && Math.abs(prev[0] - x) < 1e-9 && Math.abs(prev[1] - y) < 1e-9) {
      return
    }
    ring.push([x, y])
  }
  for (const [ax, ay, start] of corners) {
    for (let i = 0; i <= seg; i++) {
      const a = start + (Math.PI / 2) * (i / seg)
      pushPoint(ax + Math.cos(a) * r, ay + Math.sin(a) * r)
    }
  }
  const first = ring[0]!
  const last = ring[ring.length - 1]!
  if (
    ring.length > 1 &&
    Math.abs(first[0] - last[0]) < 1e-9 &&
    Math.abs(first[1] - last[1]) < 1e-9
  ) {
    ring.pop()
  }

  const count = ring.length
  const positions = new Float32Array((count + 1) * 3)
  const normals = new Float32Array((count + 1) * 3)
  const uvs = new Float32Array((count + 1) * 2)
  const indices = new Uint16Array(count * 3)

  const putVertex = (i: number, x: number, y: number): void => {
    positions[i * 3] = x
    positions[i * 3 + 1] = y + cy
    positions[i * 3 + 2] = 0
    normals[i * 3 + 2] = 1
    uvs[i * 2] = uv.x + ((x + hw) / width) * uv.width
    uvs[i * 2 + 1] = uv.y + ((hh - y) / height) * uv.height
  }

  putVertex(0, 0, 0)
  for (let i = 0; i < count; i++) putVertex(i + 1, ring[i]![0], ring[i]![1])

  for (let i = 0; i < count; i++) {
    indices[i * 3] = 0
    indices[i * 3 + 1] = i + 1
    indices[i * 3 + 2] = ((i + 1) % count) + 1
  }

  return { positions, normals, uvs, indices }
}

/**
 * A disc in the XZ plane facing `+Y`, centred at the origin. `innerRadius`
 * makes it an annulus, which is what a ring highlight around something on the
 * ground wants.
 */
export function createDiscGeometry(opts: DiscOptions): MeshGeometry {
  const seg = Math.max(3, Math.floor(opts.segments ?? 96))
  const outer = opts.radius
  const inner = Math.max(0, Math.min(opts.innerRadius ?? 0, outer))
  const solid = inner === 0
  const start = opts.startAngle ?? 0
  const sweep = opts.sweepAngle ?? Math.PI * 2
  // A full turn meets itself, so the last rim step reuses the first vertex.
  // Anything short of one needs both ends, and one more step to reach them.
  const closed = Math.abs(sweep) >= Math.PI * 2 - 1e-6
  const steps = closed ? seg : seg + 1

  const rimCount = solid ? steps + 1 : steps * 2
  const positions = new Float32Array(rimCount * 3)
  const normals = new Float32Array(rimCount * 3)
  const uvs = new Float32Array(rimCount * 2)
  const indices = new Uint16Array(seg * (solid ? 3 : 6))

  const putVertex = (i: number, x: number, z: number): void => {
    positions[i * 3] = x
    positions[i * 3 + 2] = z
    normals[i * 3 + 1] = 1
    uvs[i * 2] = (x / outer) * 0.5 + 0.5
    uvs[i * 2 + 1] = (z / outer) * 0.5 + 0.5
  }

  // Clockwise in XZ, so the winding reads counter-clockwise from +Y.
  const at = (i: number): number => start - (i / seg) * sweep
  const wrap = (i: number): number => (closed ? i % seg : i)

  if (solid) {
    putVertex(0, 0, 0)
    for (let i = 0; i < steps; i++) {
      putVertex(i + 1, Math.cos(at(i)) * outer, Math.sin(at(i)) * outer)
    }
    for (let i = 0; i < seg; i++) {
      indices[i * 3] = 0
      indices[i * 3 + 1] = i + 1
      indices[i * 3 + 2] = wrap(i + 1) + 1
    }
    return { positions, normals, uvs, indices }
  }

  for (let i = 0; i < steps; i++) {
    const c = Math.cos(at(i))
    const s = Math.sin(at(i))
    putVertex(i * 2, c * inner, s * inner)
    putVertex(i * 2 + 1, c * outer, s * outer)
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2
    const b = wrap(i + 1) * 2
    indices.set([a, a + 1, b + 1, a, b + 1, b], i * 6)
  }
  return { positions, normals, uvs, indices }
}

/**
 * A prism around the Y axis: `sides` flat faces, optional taper, optional caps.
 *
 * One builder covers a low-poly marker and a smooth cylinder: the side count
 * sets the silhouette and `smooth` sets the shading. Side vertices are
 * duplicated per face either way so the UV seam works, and the caps carry their
 * own vertices so their normals point along the axis.
 */
export function createPrismGeometry(opts: PrismOptions): MeshGeometry {
  const sides = Math.max(3, Math.floor(opts.sides))
  const rBottom = opts.radius
  const rTop = opts.topRadius ?? opts.radius
  const h = opts.height
  const caps = opts.caps ?? true
  const smooth = opts.smooth ?? false
  const y0 = opts.origin === 'center' ? -h / 2 : 0
  const y1 = y0 + h

  const sideVerts = sides * 4
  const capVerts = caps ? (sides + 1) * 2 : 0
  const positions = new Float32Array((sideVerts + capVerts) * 3)
  const normals = new Float32Array((sideVerts + capVerts) * 3)
  const uvs = new Float32Array((sideVerts + capVerts) * 2)
  const indices = new Uint16Array(sides * 6 + (caps ? sides * 6 : 0))

  const put = (
    i: number,
    x: number,
    y: number,
    z: number,
    nx: number,
    ny: number,
    nz: number,
    u: number,
    v: number,
  ): void => {
    positions[i * 3] = x
    positions[i * 3 + 1] = y
    positions[i * 3 + 2] = z
    normals[i * 3] = nx
    normals[i * 3 + 1] = ny
    normals[i * 3 + 2] = nz
    uvs[i * 2] = u
    uvs[i * 2 + 1] = v
  }

  // Angles run clockwise in XZ so both the side band and the top cap wind
  // counter-clockwise when seen from outside.
  const at = (i: number): number => (-i / sides) * Math.PI * 2
  // The normal tilts with the taper, so a cone's shading is not flat-lit.
  const slope = (rBottom - rTop) / h
  const nScale = 1 / Math.hypot(1, slope)
  /**
   * Outward normal at an angle. Flat shading shares the face's mid-angle across
   * all four of its vertices, smooth shading gives each vertex its own, which
   * is what lets the interpolation carry across a seam.
   */
  const normalAt = (a: number): [number, number, number] => [
    Math.cos(a) * nScale,
    slope * nScale,
    Math.sin(a) * nScale,
  ]

  let idx = 0
  for (let i = 0; i < sides; i++) {
    const a0 = at(i)
    const a1 = at(i + 1)
    const mid = (a0 + a1) / 2
    const [nx, ny, nz] = normalAt(mid)
    const [nx0, ny0, nz0] = smooth ? normalAt(a0) : [nx, ny, nz]
    const [nx1, ny1, nz1] = smooth ? normalAt(a1) : [nx, ny, nz]
    const base = i * 4
    const u0 = i / sides
    const u1 = (i + 1) / sides
    // The two vertices on each edge of the quad share that edge's normal, which
    // under `smooth` is the seam's own outward direction rather than the face's.
    put(
      base,
      Math.cos(a0) * rBottom,
      y0,
      Math.sin(a0) * rBottom,
      nx0,
      ny0,
      nz0,
      u0,
      1,
    )
    put(
      base + 1,
      Math.cos(a1) * rBottom,
      y0,
      Math.sin(a1) * rBottom,
      nx1,
      ny1,
      nz1,
      u1,
      1,
    )
    put(
      base + 2,
      Math.cos(a1) * rTop,
      y1,
      Math.sin(a1) * rTop,
      nx1,
      ny1,
      nz1,
      u1,
      0,
    )
    put(
      base + 3,
      Math.cos(a0) * rTop,
      y1,
      Math.sin(a0) * rTop,
      nx0,
      ny0,
      nz0,
      u0,
      0,
    )
    indices.set([base, base + 1, base + 2, base, base + 2, base + 3], idx)
    idx += 6
  }

  if (!caps) return { positions, normals, uvs, indices }

  const topBase = sideVerts
  put(topBase, 0, y1, 0, 0, 1, 0, 0.5, 0.5)
  for (let i = 0; i < sides; i++) {
    const a = at(i)
    const x = Math.cos(a) * rTop
    const z = Math.sin(a) * rTop
    put(
      topBase + 1 + i,
      x,
      y1,
      z,
      0,
      1,
      0,
      (x / (rTop || 1)) * 0.5 + 0.5,
      (z / (rTop || 1)) * 0.5 + 0.5,
    )
    indices.set(
      [topBase, topBase + 1 + i, topBase + 1 + ((i + 1) % sides)],
      idx,
    )
    idx += 3
  }

  const botBase = topBase + sides + 1
  put(botBase, 0, y0, 0, 0, -1, 0, 0.5, 0.5)
  for (let i = 0; i < sides; i++) {
    const a = at(i)
    const x = Math.cos(a) * rBottom
    const z = Math.sin(a) * rBottom
    put(
      botBase + 1 + i,
      x,
      y0,
      z,
      0,
      -1,
      0,
      (x / (rBottom || 1)) * 0.5 + 0.5,
      (z / (rBottom || 1)) * 0.5 + 0.5,
    )
    // Reversed relative to the top cap, since this face is seen from -Y.
    indices.set(
      [botBase, botBase + 1 + ((i + 1) % sides), botBase + 1 + i],
      idx,
    )
    idx += 3
  }

  return { positions, normals, uvs, indices }
}

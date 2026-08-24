import { describe, expect, it } from 'vitest'
import {
  createDiscGeometry,
  createPrismGeometry,
  createQuadGeometry,
  createRoundedQuadGeometry,
} from './geometry'
import type { MeshGeometry } from './MeshNode'

// These assert the contracts a builder cannot express in its types: that every
// triangle faces the way its normals claim, that normals are unit length, and
// that UVs stay inside the rect they were given. A back-facing triangle is
// culled rather than drawn wrong, so it fails silently on screen.

interface Vec {
  x: number
  y: number
  z: number
}

const vertexAt = (g: MeshGeometry, i: number): Vec => ({
  x: g.positions[i * 3]!,
  y: g.positions[i * 3 + 1]!,
  z: g.positions[i * 3 + 2]!,
})

const normalAt = (g: MeshGeometry, i: number): Vec => ({
  x: g.normals[i * 3]!,
  y: g.normals[i * 3 + 1]!,
  z: g.normals[i * 3 + 2]!,
})

/** Geometric normal of a triangle, from its winding. */
function faceNormal(g: MeshGeometry, tri: number): Vec {
  const a = vertexAt(g, g.indices[tri * 3]!)
  const b = vertexAt(g, g.indices[tri * 3 + 1]!)
  const c = vertexAt(g, g.indices[tri * 3 + 2]!)
  const u = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }
  const v = { x: c.x - a.x, y: c.y - a.y, z: c.z - a.z }
  return {
    x: u.y * v.z - u.z * v.y,
    y: u.z * v.x - u.x * v.z,
    z: u.x * v.y - u.y * v.x,
  }
}

const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y + a.z * b.z
const triangleCount = (g: MeshGeometry): number => g.indices.length / 3

/**
 * Every triangle winds counter-clockwise as seen from the side its own vertex
 * normals point toward, which is what the back-face cull expects.
 */
function expectFrontFacing(g: MeshGeometry, name: string): void {
  for (let t = 0; t < triangleCount(g); t++) {
    const shading = normalAt(g, g.indices[t * 3]!)
    expect(
      dot(faceNormal(g, t), shading),
      `${name} triangle ${t}`,
    ).toBeGreaterThan(0)
  }
}

function expectUnitNormals(g: MeshGeometry, name: string): void {
  for (let i = 0; i < g.normals.length / 3; i++) {
    const n = normalAt(g, i)
    expect(Math.hypot(n.x, n.y, n.z), `${name} normal ${i}`).toBeCloseTo(1, 5)
  }
}

function expectWellFormed(g: MeshGeometry, name: string): void {
  const count = g.positions.length / 3
  expect(g.normals.length, `${name} normals`).toBe(g.positions.length)
  expect(g.uvs?.length, `${name} uvs`).toBe(count * 2)
  expect(g.indices.length % 3, `${name} whole triangles`).toBe(0)
  expect(g.indices).toBeInstanceOf(Uint16Array)
  for (let i = 0; i < g.indices.length; i++) {
    expect(g.indices[i], `${name} index ${i}`).toBeLessThan(count)
  }
  expectUnitNormals(g, name)
  expectFrontFacing(g, name)
}

const bounds = (g: MeshGeometry) => {
  const min = { x: Infinity, y: Infinity, z: Infinity }
  const max = { x: -Infinity, y: -Infinity, z: -Infinity }
  for (let i = 0; i < g.positions.length / 3; i++) {
    const v = vertexAt(g, i)
    min.x = Math.min(min.x, v.x)
    min.y = Math.min(min.y, v.y)
    min.z = Math.min(min.z, v.z)
    max.x = Math.max(max.x, v.x)
    max.y = Math.max(max.y, v.y)
    max.z = Math.max(max.z, v.z)
  }
  return { min, max }
}

describe('createQuadGeometry', () => {
  it('is a well-formed quad facing +Z', () => {
    const g = createQuadGeometry({ width: 2, height: 4 })
    expectWellFormed(g, 'quad')
    expect(triangleCount(g)).toBe(2)
    expect(normalAt(g, 0)).toEqual({ x: 0, y: 0, z: 1 })
  })

  it('centers on the origin by default', () => {
    const { min, max } = bounds(createQuadGeometry({ width: 2, height: 4 }))
    expect([min.x, max.x, min.y, max.y]).toEqual([-1, 1, -2, 2])
  })

  it('sits on y = 0 with a bottom origin', () => {
    const { min, max } = bounds(
      createQuadGeometry({ width: 2, height: 4, origin: 'bottom' }),
    )
    expect(min.y).toBe(0)
    expect(max.y).toBe(4)
  })

  it('maps a uv sub-rect across the quad', () => {
    const g = createQuadGeometry({
      width: 1,
      height: 1,
      uvRect: { x: 0.25, y: 0.5, width: 0.25, height: 0.5 },
    })
    const us = [...g.uvs!].filter((_, i) => i % 2 === 0)
    const vs = [...g.uvs!].filter((_, i) => i % 2 === 1)
    expect(Math.min(...us)).toBeCloseTo(0.25)
    expect(Math.max(...us)).toBeCloseTo(0.5)
    expect(Math.min(...vs)).toBeCloseTo(0.5)
    expect(Math.max(...vs)).toBeCloseTo(1)
  })
})

describe('createRoundedQuadGeometry', () => {
  const card = { width: 0.128, height: 0.194, radius: 0.012 }

  it('is well formed', () => {
    expectWellFormed(createRoundedQuadGeometry(card), 'rounded quad')
  })

  it('stays within the rectangle it was asked for', () => {
    const { min, max } = bounds(createRoundedQuadGeometry(card))
    expect(min.x).toBeGreaterThanOrEqual(-card.width / 2 - 1e-6)
    expect(max.x).toBeLessThanOrEqual(card.width / 2 + 1e-6)
    expect(min.y).toBeGreaterThanOrEqual(-card.height / 2 - 1e-6)
    expect(max.y).toBeLessThanOrEqual(card.height / 2 + 1e-6)
  })

  it('rounds the corners, so they clear the rectangle corner', () => {
    const g = createRoundedQuadGeometry(card)
    const hw = card.width / 2
    const hh = card.height / 2
    for (let i = 0; i < g.positions.length / 3; i++) {
      const v = vertexAt(g, i)
      // Inside the corner box, a point must lie on or inside the corner arc.
      const dx = Math.abs(v.x) - (hw - card.radius)
      const dy = Math.abs(v.y) - (hh - card.radius)
      if (dx > 0 && dy > 0) {
        expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(card.radius + 1e-6)
      }
    }
  })

  it('clamps an oversized radius to a stadium rather than inverting', () => {
    const g = createRoundedQuadGeometry({ width: 1, height: 1, radius: 99 })
    expectWellFormed(g, 'over-rounded quad')
    const { min, max } = bounds(g)
    expect(max.x - min.x).toBeCloseTo(1)
    expect(max.y - min.y).toBeCloseTo(1)
  })

  it('degrades to a plain rectangle at radius 0', () => {
    const { min, max } = bounds(
      createRoundedQuadGeometry({ width: 2, height: 3, radius: 0 }),
    )
    expect([min.x, max.x, min.y, max.y]).toEqual([-1, 1, -1.5, 1.5])
  })

  it('sits on y = 0 with a bottom origin', () => {
    const { min } = bounds(
      createRoundedQuadGeometry({ ...card, origin: 'bottom' }),
    )
    expect(min.y).toBeCloseTo(0)
  })
})

describe('createDiscGeometry', () => {
  it('is a well-formed disc facing +Y', () => {
    const g = createDiscGeometry({ radius: 2, segments: 16 })
    expectWellFormed(g, 'disc')
    expect(triangleCount(g)).toBe(16)
    expect(normalAt(g, 0)).toEqual({ x: 0, y: 1, z: 0 })
  })

  it('spans its radius and stays flat', () => {
    const { min, max } = bounds(createDiscGeometry({ radius: 2, segments: 64 }))
    expect(max.x).toBeCloseTo(2, 2)
    expect(min.x).toBeCloseTo(-2, 2)
    expect(min.y).toBe(0)
    expect(max.y).toBe(0)
  })

  it('builds an annulus with a hole when given an inner radius', () => {
    const g = createDiscGeometry({ radius: 2, innerRadius: 1, segments: 16 })
    expectWellFormed(g, 'annulus')
    expect(triangleCount(g)).toBe(32)
    for (let i = 0; i < g.positions.length / 3; i++) {
      const v = vertexAt(g, i)
      expect(Math.hypot(v.x, v.z)).toBeGreaterThanOrEqual(1 - 1e-6)
    }
  })

  // A full turn meets itself and reuses the first rim vertex. Anything short of
  // one has two ends, so it needs an extra step to reach the far one, and the
  // wrap that closes a ring would fold the last triangle back across it.
  it('leaves a partial sweep open, with the same triangle count', () => {
    const full = createDiscGeometry({ radius: 2, segments: 16 })
    const half = createDiscGeometry({
      radius: 2,
      segments: 16,
      sweepAngle: Math.PI,
    })
    expectWellFormed(half, 'half disc')
    expect(triangleCount(half)).toBe(triangleCount(full))
    expect(half.positions.length).toBeGreaterThan(full.positions.length)
  })

  it('sweeps clockwise in XZ from where it is told to start', () => {
    // Starting at -X and sweeping half a turn covers the +Z side only, which
    // is the half nearest a camera looking down -Z.
    const g = createDiscGeometry({
      radius: 2,
      innerRadius: 1.7,
      segments: 24,
      startAngle: Math.PI,
      sweepAngle: Math.PI,
    })
    expectWellFormed(g, 'arc band')
    for (let i = 0; i < g.positions.length / 3; i++) {
      expect(vertexAt(g, i).z).toBeGreaterThanOrEqual(-1e-6)
    }
    const { min, max } = bounds(g)
    expect(min.x).toBeCloseTo(-2, 6)
    expect(max.x).toBeCloseTo(2, 6)
  })

  it('makes a pie slice when a partial sweep has no hole', () => {
    const g = createDiscGeometry({
      radius: 1,
      segments: 8,
      sweepAngle: Math.PI / 2,
    })
    expectWellFormed(g, 'pie')
    expect(triangleCount(g)).toBe(8)
    // The centre is a corner of the slice, so it is part of the shape.
    expect(vertexAt(g, 0)).toEqual({ x: 0, y: 0, z: 0 })
  })
})

describe('createPrismGeometry', () => {
  it('is a well-formed capped cylinder', () => {
    const g = createPrismGeometry({ sides: 24, radius: 1, height: 2 })
    expectWellFormed(g, 'cylinder')
    // Two triangles per side face, plus one per side on each cap.
    expect(triangleCount(g)).toBe(24 * 2 + 24 * 2)
  })

  it('stands on y = 0 by default and centers with a center origin', () => {
    const base = bounds(createPrismGeometry({ sides: 6, radius: 1, height: 2 }))
    expect(base.min.y).toBe(0)
    expect(base.max.y).toBe(2)
    const mid = bounds(
      createPrismGeometry({ sides: 6, radius: 1, height: 2, origin: 'center' }),
    )
    expect(mid.min.y).toBe(-1)
    expect(mid.max.y).toBe(1)
  })

  it('points side normals radially outward on an untapered prism', () => {
    const g = createPrismGeometry({ sides: 12, radius: 1, height: 1 })
    // Side vertices come first, four per face.
    for (let i = 0; i < 12 * 4; i++) {
      const n = normalAt(g, i)
      expect(n.y).toBeCloseTo(0, 6)
      const v = vertexAt(g, i)
      // The normal agrees with the direction out from the axis.
      expect(n.x * v.x + n.z * v.z).toBeGreaterThan(0)
    }
  })

  it('tilts side normals up on a taper, so a cone is not flat lit', () => {
    const g = createPrismGeometry({
      sides: 12,
      radius: 1,
      topRadius: 0.2,
      height: 1,
    })
    expectWellFormed(g, 'tapered prism')
    expect(normalAt(g, 0).y).toBeGreaterThan(0)
  })

  it('gives each side vertex its own outward normal when smoothed', () => {
    const g = createPrismGeometry({
      sides: 12,
      radius: 1,
      height: 1,
      smooth: true,
    })
    expectWellFormed(g, 'smooth cylinder')
    // Flat shading shares one normal across a face's four vertices, so the two
    // on each edge differ only under smoothing. That difference is what the
    // fragment stage interpolates across the seam.
    const a = normalAt(g, 0)
    const b = normalAt(g, 1)
    expect(a).not.toEqual(b)
    for (let i = 0; i < 12 * 4; i++) {
      const n = normalAt(g, i)
      const v = vertexAt(g, i)
      // Each normal points straight out from the axis at that vertex's angle.
      const radial = Math.hypot(v.x, v.z)
      expect(n.x).toBeCloseTo(v.x / radial, 6)
      expect(n.z).toBeCloseTo(v.z / radial, 6)
    }
  })

  it('keeps facets flat by default, which is the point of a low side count', () => {
    const g = createPrismGeometry({ sides: 3, radius: 1, height: 1 })
    expect(normalAt(g, 0)).toEqual(normalAt(g, 1))
  })

  it('drops the caps when asked', () => {
    const g = createPrismGeometry({
      sides: 8,
      radius: 1,
      height: 1,
      caps: false,
    })
    expectWellFormed(g, 'open prism')
    expect(triangleCount(g)).toBe(16)
  })

  it('builds the low side counts used for seat markers', () => {
    for (const sides of [3, 4, 5, 6]) {
      const g = createPrismGeometry({ sides, radius: 1, height: 0.2 })
      expectWellFormed(g, `${sides}-sided prism`)
    }
  })
})

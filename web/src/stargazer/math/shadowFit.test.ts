import { describe, it, expect } from 'vitest'
import { fitDirectionalOrtho, type Aabb } from './shadowFit'
import { mat4TransformPoint } from './Mat4'
import { vec3 } from './Vec3'

const box = (r: number): Aabb => ({ min: vec3(-r, -r, -r), max: vec3(r, r, r) })

/**
 * Project each of the AABB's 8 corners and pass them to `visit` (post-divide
 * NDC).
 */
function forEachCorner(
  aabb: Aabb,
  m: Float32Array,
  visit: (p: ReturnType<typeof vec3>) => void,
) {
  for (let i = 0; i < 8; i++) {
    visit(
      mat4TransformPoint(
        vec3(),
        m,
        i & 1 ? aabb.max.x : aabb.min.x,
        i & 2 ? aabb.max.y : aabb.min.y,
        i & 4 ? aabb.max.z : aabb.min.z,
      ),
    )
  }
}

describe('fitDirectionalOrtho', () => {
  it('projects every caster corner into clip space', () => {
    const aabb = box(1)
    const vp = fitDirectionalOrtho(aabb, vec3(0, -1, 0), 1024)
    forEachCorner(aabb, vp, (p) => {
      expect(Math.abs(p.x)).toBeLessThanOrEqual(1.0001)
      expect(Math.abs(p.y)).toBeLessThanOrEqual(1.0001)
      expect(p.z).toBeGreaterThanOrEqual(-1.0001)
      expect(p.z).toBeLessThanOrEqual(1.0001)
    })
  })

  it('is deterministic for identical inputs', () => {
    const aabb = box(2)
    const a = fitDirectionalOrtho(aabb, vec3(-0.3, -1, -0.2), 1024)
    const b = fitDirectionalOrtho(aabb, vec3(-0.3, -1, -0.2), 1024)
    for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], 6)
  })

  it('translates the box by whole texels when the scene translates (no shimmer)', () => {
    // A one-texel world shift of the scene shifts a fixed point's projection by
    // exactly one texel.
    const texSize = 1024
    const r = 4
    const dir = vec3(0, -1, 0)
    const texel = (2 * r) / texSize
    const base = box(r)
    const shifted: Aabb = {
      min: vec3(base.min.x + texel, base.min.y, base.min.z),
      max: vec3(base.max.x + texel, base.max.y, base.max.z),
    }
    const vpA = fitDirectionalOrtho(base, dir, texSize)
    const vpB = fitDirectionalOrtho(shifted, dir, texSize)
    // Project the same world point through both; light-space x shifts by 1 texel
    // of NDC (2 / texSize), not a fractional smear.
    const pa = mat4TransformPoint(vec3(), vpA, 0, 0, 0)
    const pb = mat4TransformPoint(vec3(), vpB, 0, 0, 0)
    // The shift is one NDC texel (2 / texSize). Its sign follows the light-space
    // x-axis orientation, so the test checks the magnitude.
    expect(Math.abs(pb.x - pa.x)).toBeCloseTo(2 / texSize, 4)
  })

  it('caps the extent with maxDistance', () => {
    // A tight cap keeps the box center inside clip while far corners fall outside.
    const aabb = box(10)
    const vp = fitDirectionalOrtho(aabb, vec3(0, -1, 0), 1024, 1)
    const center = mat4TransformPoint(vec3(), vp, 0, 0, 0)
    expect(Math.abs(center.x)).toBeLessThanOrEqual(0.5)
    let anyOutside = false
    forEachCorner(aabb, vp, (p) => {
      if (Math.abs(p.x) > 1 || Math.abs(p.y) > 1) anyOutside = true
    })
    expect(anyOutside).toBe(true)
  })
})

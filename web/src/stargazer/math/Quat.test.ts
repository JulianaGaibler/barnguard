import { describe, expect, it } from 'vitest'
import {
  quat,
  quatIdentity,
  quatFromAxisAngle,
  quatMultiply,
  quatNormalize,
  quatSlerp,
} from './Quat'
import { mat4, mat4Compose, mat4TransformPoint } from './Mat4'
import { vec3 } from './Vec3'

const HALF_PI = Math.PI / 2

/** Rotate a point by a quaternion via a scale-1 compose, for assertions. */
function rotatePoint(q: ReturnType<typeof quat>, x: number, y: number, z: number) {
  const m = mat4Compose(mat4(), vec3(0, 0, 0), q, vec3(1, 1, 1))
  return mat4TransformPoint(vec3(), m, x, y, z)
}

describe('quatFromAxisAngle', () => {
  it('90° about +z maps (1,0,0) to (0,1,0)', () => {
    const q = quatFromAxisAngle(quat(), 0, 0, 1, HALF_PI)
    const p = rotatePoint(q, 1, 0, 0)
    expect(p.x).toBeCloseTo(0, 4)
    expect(p.y).toBeCloseTo(1, 4)
    expect(p.z).toBeCloseTo(0, 4)
  })
})

describe('quatMultiply', () => {
  it('composes two 90° z-rotations into a 180° flip', () => {
    const q90 = quatFromAxisAngle(quat(), 0, 0, 1, HALF_PI)
    const q180 = quatMultiply(quat(), q90, q90)
    const p = rotatePoint(q180, 1, 0, 0)
    expect(p.x).toBeCloseTo(-1, 4)
    expect(p.y).toBeCloseTo(0, 4)
  })

  it('is safe when dst aliases an input', () => {
    const a = quatFromAxisAngle(quat(), 1, 0, 0, 0.5)
    const b = quatFromAxisAngle(quat(), 0, 1, 0, 0.3)
    const expected = quatMultiply(quat(), a, b)
    const aliased = quatMultiply(a, a, b)
    expect(aliased.x).toBeCloseTo(expected.x, 6)
    expect(aliased.w).toBeCloseTo(expected.w, 6)
  })
})

describe('quatNormalize', () => {
  it('returns identity for a zero quaternion', () => {
    expect(quatNormalize(quat(), { x: 0, y: 0, z: 0, w: 0 })).toMatchObject({
      x: 0,
      y: 0,
      z: 0,
      w: 1,
    })
  })

  it('produces a unit quaternion', () => {
    const n = quatNormalize(quat(), { x: 0, y: 3, z: 0, w: 4 })
    expect(Math.hypot(n.x, n.y, n.z, n.w)).toBeCloseTo(1, 6)
  })
})

describe('quatSlerp', () => {
  it('t=0 gives a, t=1 gives b', () => {
    const a = quatIdentity(quat())
    const b = quatFromAxisAngle(quat(), 0, 1, 0, HALF_PI)
    const at0 = quatSlerp(quat(), a, b, 0)
    const at1 = quatSlerp(quat(), a, b, 1)
    expect(at0.w).toBeCloseTo(a.w, 5)
    expect(at1.y).toBeCloseTo(b.y, 5)
    expect(at1.w).toBeCloseTo(b.w, 5)
  })

  it('midpoint is the half-angle rotation', () => {
    const a = quatIdentity(quat())
    const b = quatFromAxisAngle(quat(), 0, 1, 0, HALF_PI)
    const mid = quatSlerp(quat(), a, b, 0.5)
    const expected = quatFromAxisAngle(quat(), 0, 1, 0, HALF_PI / 2)
    expect(mid.y).toBeCloseTo(expected.y, 5)
    expect(mid.w).toBeCloseTo(expected.w, 5)
  })

  it('takes the shorter arc across opposite hemispheres', () => {
    const a = quatIdentity(quat())
    // Negated identity is the same rotation; slerp should stay near identity.
    const b = { x: 0, y: 0, z: 0, w: -1 }
    const mid = quatSlerp(quat(), a, b, 0.5)
    expect(Math.abs(mid.w)).toBeCloseTo(1, 5)
    expect(mid.x).toBeCloseTo(0, 5)
  })
})

import { describe, expect, it } from 'vitest'
import {
  mat4,
  mat4Identity,
  mat4Multiply,
  mat4Invert,
  mat4Perspective,
  mat4Ortho,
  mat4LookAt,
  mat4Compose,
  mat4TransformPoint,
  mat4TransformDir,
  type Mat4,
} from './Mat4'
import { quat, quatFromAxisAngle } from './Quat'
import { vec3 } from './Vec3'

const HALF_PI = Math.PI / 2

function expectMat4Close(a: Mat4, b: readonly number[]): void {
  for (let i = 0; i < 16; i++) expect(a[i]).toBeCloseTo(b[i], 4)
}

describe('mat4', () => {
  it('creates an identity matrix', () => {
    expectMat4Close(mat4(), [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  })
})

describe('mat4Multiply', () => {
  it('identity is a left and right unit', () => {
    const m = mat4Compose(mat4(), vec3(1, 2, 3), quat(), vec3(2, 2, 2))
    const id = mat4()
    expectMat4Close(mat4Multiply(mat4(), id, m), Array.from(m))
    expectMat4Close(mat4Multiply(mat4(), m, id), Array.from(m))
  })

  it('is safe when dst aliases an input', () => {
    const a = mat4Compose(mat4(), vec3(1, 0, 0), quat(), vec3(1, 1, 1))
    const b = mat4Compose(mat4(), vec3(0, 2, 0), quat(), vec3(1, 1, 1))
    const expected = mat4Multiply(mat4(), a, b)
    const aliased = mat4Multiply(a, a, b)
    expectMat4Close(aliased, Array.from(expected))
  })
})

describe('mat4Invert', () => {
  it('inverse composes to identity', () => {
    const q = quatFromAxisAngle(quat(), 0, 1, 0, 0.7)
    const m = mat4Compose(mat4(), vec3(3, -2, 5), q, vec3(2, 0.5, 1.5))
    const inv = mat4()
    expect(mat4Invert(inv, m)).toBe(true)
    expectMat4Close(mat4Multiply(mat4(), m, inv), [
      1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
    ])
  })

  it('returns false and identity for a singular matrix', () => {
    const singular = mat4Compose(mat4(), vec3(1, 1, 1), quat(), vec3(0, 1, 1))
    const inv = mat4Identity(mat4())
    expect(mat4Invert(inv, singular)).toBe(false)
    expectMat4Close(inv, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
  })
})

describe('mat4Compose', () => {
  it('translates a point by the position', () => {
    const m = mat4Compose(mat4(), vec3(10, 20, 30), quat(), vec3(1, 1, 1))
    const out = mat4TransformPoint(vec3(), m, 0, 0, 0)
    expect(out).toMatchObject({ x: 10, y: 20, z: 30 })
  })

  it('applies scale then rotation then translation', () => {
    // 90° about +z maps (1,0,0) -> (0,1,0); scale 2 first, translate after.
    const q = quatFromAxisAngle(quat(), 0, 0, 1, HALF_PI)
    const m = mat4Compose(mat4(), vec3(5, 0, 0), q, vec3(2, 2, 2))
    const out = mat4TransformPoint(vec3(), m, 1, 0, 0)
    expect(out.x).toBeCloseTo(5, 4)
    expect(out.y).toBeCloseTo(2, 4)
    expect(out.z).toBeCloseTo(0, 4)
  })
})

describe('mat4Perspective', () => {
  it('maps the near plane center to NDC z = -1 and far to +1', () => {
    const m = mat4Perspective(mat4(), HALF_PI, 1, 1, 100)
    const near = mat4TransformPoint(vec3(), m, 0, 0, -1)
    const far = mat4TransformPoint(vec3(), m, 0, 0, -100)
    expect(near.z).toBeCloseTo(-1, 4)
    expect(far.z).toBeCloseTo(1, 4)
  })

  it('supports an infinite far plane', () => {
    const m = mat4Perspective(mat4(), HALF_PI, 1.5, 0.5, Infinity)
    const near = mat4TransformPoint(vec3(), m, 0, 0, -0.5)
    expect(near.z).toBeCloseTo(-1, 4)
    expect(Number.isFinite(m[10])).toBe(true)
  })
})

describe('mat4Ortho', () => {
  it('maps the box corners into the NDC cube', () => {
    const m = mat4Ortho(mat4(), -2, 2, -1, 1, 1, 10)
    const min = mat4TransformPoint(vec3(), m, -2, -1, -1)
    const max = mat4TransformPoint(vec3(), m, 2, 1, -10)
    expect(min.x).toBeCloseTo(-1, 4)
    expect(min.y).toBeCloseTo(-1, 4)
    expect(min.z).toBeCloseTo(-1, 4)
    expect(max.x).toBeCloseTo(1, 4)
    expect(max.y).toBeCloseTo(1, 4)
    expect(max.z).toBeCloseTo(1, 4)
  })
})

describe('mat4LookAt', () => {
  it('places the camera so the target sits down -z', () => {
    const view = mat4LookAt(mat4(), vec3(0, 0, 5), vec3(0, 0, 0), vec3(0, 1, 0))
    const originInView = mat4TransformPoint(vec3(), view, 0, 0, 0)
    // World origin is 5 units in front of the camera (-z).
    expect(originInView.x).toBeCloseTo(0, 4)
    expect(originInView.y).toBeCloseTo(0, 4)
    expect(originInView.z).toBeCloseTo(-5, 4)
  })
})

describe('mat4TransformDir', () => {
  it('ignores translation', () => {
    const m = mat4Compose(mat4(), vec3(100, 100, 100), quat(), vec3(1, 1, 1))
    const out = mat4TransformDir(vec3(), m, 1, 0, 0)
    expect(out).toMatchObject({ x: 1, y: 0, z: 0 })
  })
})

import { describe, expect, it, vi } from 'vitest'
import { Transform3D } from './Transform3D'
import { mat4TransformPoint } from './Mat4'
import { quatFromAxisAngle, quat } from './Quat'
import { vec3 } from './Vec3'

const HALF_PI = Math.PI / 2

describe('Transform3D', () => {
  it('starts dirty and rebuilds an identity local when untouched', () => {
    const t = new Transform3D()
    expect(t.dirty).toBe(true)
    t.updateLocal()
    expect(t.dirty).toBe(false)
    const p = mat4TransformPoint(vec3(), t.local, 1, 2, 3)
    expect(p).toMatchObject({ x: 1, y: 2, z: 3 })
  })

  it('composes translation into local', () => {
    const t = new Transform3D()
    t.setPosition(10, -5, 2)
    t.updateLocal()
    const p = mat4TransformPoint(vec3(), t.local, 0, 0, 0)
    expect(p).toMatchObject({ x: 10, y: -5, z: 2 })
  })

  it('composes rotation and scale (scale first, then rotate, then translate)', () => {
    const t = new Transform3D()
    const q = quatFromAxisAngle(quat(), 0, 0, 1, HALF_PI)
    t.setRotation(q.x, q.y, q.z, q.w)
    t.setScale(2, 2, 2)
    t.setPosition(1, 0, 0)
    t.updateLocal()
    const p = mat4TransformPoint(vec3(), t.local, 1, 0, 0)
    expect(p.x).toBeCloseTo(1, 4)
    expect(p.y).toBeCloseTo(2, 4)
  })

  it('fires onDirty once on the clean→dirty transition', () => {
    const t = new Transform3D()
    t.updateLocal() // clean
    const onDirty = vi.fn()
    t.onDirty = onDirty
    t.setPosition(1, 1, 1)
    t.setScale(2, 2, 2)
    // Both mutations happened while already dirty after the first → one fire.
    expect(onDirty).toHaveBeenCalledTimes(1)
  })

  it('re-arms onDirty after updateLocal clears the flag', () => {
    const t = new Transform3D()
    t.updateLocal()
    const onDirty = vi.fn()
    t.onDirty = onDirty
    t.setPosition(1, 0, 0)
    t.updateLocal()
    t.setPosition(2, 0, 0)
    expect(onDirty).toHaveBeenCalledTimes(2)
  })

  it('markDirty forces a rebuild after an in-place field edit', () => {
    const t = new Transform3D()
    t.updateLocal()
    t.position.x = 7
    // No mutation observed yet, so local is stale.
    t.markDirty()
    t.updateLocal()
    const p = mat4TransformPoint(vec3(), t.local, 0, 0, 0)
    expect(p.x).toBeCloseTo(7, 4)
  })
})

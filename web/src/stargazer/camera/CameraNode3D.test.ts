import { describe, expect, it } from 'vitest'
import { CameraNode3D } from './CameraNode3D'
import { Node3D } from '../scene/Node3D'

describe('CameraNode3D (view from node world)', () => {
  it('eyePosition reads the node world translation', () => {
    const cam = new CameraNode3D()
    cam.transform.setPosition(1, 2, 8)
    const eye = cam.eyePosition()
    expect(eye.x).toBeCloseTo(1, 6)
    expect(eye.y).toBeCloseTo(2, 6)
    expect(eye.z).toBeCloseTo(8, 6)
  })

  it('a parented camera takes its eye from the world pose', () => {
    const pivot = new Node3D()
    const cam = new CameraNode3D()
    pivot.add(cam)
    pivot.transform.setPosition(0, 0, 10)
    const eye = cam.eyePosition()
    expect(eye.x).toBeCloseTo(0, 6)
    expect(eye.y).toBeCloseTo(0, 6)
    expect(eye.z).toBeCloseTo(10, 6)
  })

  it('refreshes viewProjection when the node moves (S5: no stale matrix)', () => {
    const cam = new CameraNode3D()
    cam.setAspect(1)
    cam.transform.setPosition(0, 0, 8)
    const vp1 = Float32Array.from(cam.viewProjection)
    cam.transform.setPosition(0, 0, 4)
    const vp2 = cam.viewProjection
    let changed = false
    for (let i = 0; i < 16; i++) {
      if (Math.abs(vp1[i] - vp2[i]) > 1e-6) changed = true
    }
    expect(changed).toBe(true)
  })

  it('screenToRay origin sits near the moved eye', () => {
    const cam = new CameraNode3D()
    cam.setAspect(1)
    cam.transform.setPosition(5, 0, 8)
    const ray = cam.screenToRay(0, 0)
    // Near-plane point of a centered ray is close to the eye in x.
    expect(ray.origin.x).toBeCloseTo(5, 1)
  })

  it('is leaf-only: rejects children', () => {
    const cam = new CameraNode3D()
    expect(() => cam.add(new Node3D())).toThrow(/leaf node/)
  })
})

import { describe, expect, it } from 'vitest'
import { Camera3D } from './Camera3D'
import { mat4TransformPoint } from '../math/Mat4'
import { vec3 } from '../math/Vec3'

describe('Camera3D view', () => {
  it('places a world point in front of the camera along -z', () => {
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 5)
    const inView = mat4TransformPoint(vec3(), cam.view, 0, 0, 0)
    // World origin is 5 units ahead of the camera (camera looks down -z).
    expect(inView.z).toBeCloseTo(-5, 4)
    expect(inView.x).toBeCloseTo(0, 4)
    expect(inView.y).toBeCloseTo(0, 4)
  })
})

describe('Camera3D projection blend', () => {
  it('holds on-screen scale at the focal distance across the blend', () => {
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 0) // eye at origin, looking down -z
    cam.setAspect(1)
    cam.focalDistance = 8
    // A point on the focal plane, offset sideways.
    const px = 1
    const pz = -8

    cam.projectionness = 1 // perspective
    const persp = mat4TransformPoint(vec3(), cam.viewProjection, px, 0, pz)
    cam.projectionness = 0 // ortho
    const ortho = mat4TransformPoint(vec3(), cam.viewProjection, px, 0, pz)

    // Same NDC x at the focal plane regardless of projection mode.
    expect(ortho.x).toBeCloseTo(persp.x, 4)
  })

  it('maps the focal-plane point to identical NDC at t=0.5', () => {
    const cam = new Camera3D()
    cam.setAspect(1)
    cam.focalDistance = 6
    const at = (t: number) => {
      cam.projectionness = t
      return mat4TransformPoint(vec3(), cam.viewProjection, 0.5, 0, -6)
    }
    const a = at(0)
    const b = at(1)
    const mid = at(0.5)
    // The focal point is scale-stable, so every blend agrees on x.
    expect(mid.x).toBeCloseTo(a.x, 4)
    expect(mid.x).toBeCloseTo(b.x, 4)
  })
})

describe('Camera3D worldToScreen', () => {
  it('projects the look-at point to the canvas center', () => {
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 10)
    cam.setAspect(1)
    cam.projectionness = 1
    const p = cam.worldToScreen(0, 0, 0, 400, 300)
    expect(p.behind).toBe(false)
    expect(p.x).toBeCloseTo(200, 3)
    expect(p.y).toBeCloseTo(150, 3)
  })

  it('maps a down-left world point to the lower-left of the canvas', () => {
    const cam = new Camera3D()
    cam.transform.setPosition(0, 1.2, 3)
    cam.setAspect(1600 / 900)
    cam.projectionness = 1
    // In front of the camera, to its left and below its eye height.
    const p = cam.worldToScreen(-2.4, 0, -6, 1600, 900)
    expect(p.behind).toBe(false)
    expect(p.x).toBeLessThan(800) // left of center
    expect(p.y).toBeGreaterThan(450) // below center
  })

  it('flags a point behind the camera', () => {
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 10)
    cam.setAspect(1)
    // Behind the camera (camera at z=10 looking -z; z=20 is behind it).
    const p = cam.worldToScreen(0, 0, 20, 400, 300)
    expect(p.behind).toBe(true)
  })

  it('round-trips with screenToRay at the center', () => {
    const cam = new Camera3D()
    cam.transform.setPosition(3, 1, 8)
    cam.setAspect(16 / 9)
    cam.projectionness = 1
    // A world point in front of the camera projects to some screen px; the ray
    // through that pixel points back toward the point.
    const wx = 3
    const wy = 1
    const wz = 0
    const s = cam.worldToScreen(wx, wy, wz, 1600, 900)
    const ndcX = (2 * s.x) / 1600 - 1
    const ndcY = 1 - (2 * s.y) / 900
    const ray = cam.screenToRay(ndcX, ndcY)
    // Direction from the ray origin toward the world point matches the ray dir.
    const dx = wx - ray.origin.x
    const dy = wy - ray.origin.y
    const dz = wz - ray.origin.z
    const len = Math.hypot(dx, dy, dz)
    expect(ray.direction.x).toBeCloseTo(dx / len, 3)
    expect(ray.direction.y).toBeCloseTo(dy / len, 3)
    expect(ray.direction.z).toBeCloseTo(dz / len, 3)
  })
})

describe('Camera3D screenToRay', () => {
  it('center ray points down -z from a camera on +z', () => {
    const cam = new Camera3D()
    cam.transform.setPosition(0, 0, 10)
    cam.setAspect(1)
    cam.projectionness = 1
    const ray = cam.screenToRay(0, 0)
    expect(ray.direction.z).toBeLessThan(0)
    expect(ray.direction.x).toBeCloseTo(0, 3)
    expect(ray.direction.y).toBeCloseTo(0, 3)
  })
})

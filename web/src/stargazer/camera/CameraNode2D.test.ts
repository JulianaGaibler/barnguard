import { describe, expect, it } from 'vitest'
import { Camera } from './Camera'
import { CameraNode2D } from './CameraNode2D'
import { Node2D } from '../scene/Node2D'

describe('CameraNode2D (transform + framing unified)', () => {
  it('matches the plain Camera view for an identity transform (Part A parity)', () => {
    const vp = { x: 100, y: 200, width: 400, height: 300 }
    const ref = new Camera(vp)
    ref.setPixelSize(800, 600)

    const cam = new CameraNode2D()
    cam.setViewport(vp)
    cam.setPixelSize(800, 600)

    const w = { x: 250, y: 350 }
    const refS = ref.worldToScreen(w.x, w.y)
    const nodeS = cam.worldToScreen(w.x, w.y)
    expect(nodeS.x).toBeCloseTo(refS.x, 6)
    expect(nodeS.y).toBeCloseTo(refS.y, 6)

    // getScreenAffine for an identity camera is the uniform screen transform.
    const t = ref.getScreenTransform()
    const S = cam.getScreenAffine()
    expect(S.a).toBeCloseTo(t.scale, 6)
    expect(S.b).toBeCloseTo(0, 6)
    expect(S.c).toBeCloseTo(0, 6)
    expect(S.d).toBeCloseTo(t.scale, 6)
    expect(S.e).toBeCloseTo(t.offsetX, 6)
    expect(S.f).toBeCloseTo(t.offsetY, 6)

    expect(cam.strokeSpaceScale()).toBeCloseTo(ref.strokeSpaceScale(), 6)
  })

  it('getRenderAffine folds DPR onto the screen affine (matches old dprScale/offset)', () => {
    const cam = new CameraNode2D()
    cam.setViewport({ x: 0, y: 0, width: 100, height: 100 })
    cam.setPixelSize(200, 200) // scale 2, centered
    const S = cam.getScreenAffine()
    const R = cam.getRenderAffine(3)
    expect(R.a).toBeCloseTo(3 * S.a, 6)
    expect(R.d).toBeCloseTo(3 * S.d, 6)
    expect(R.e).toBeCloseTo(3 * S.e, 6)
    expect(R.f).toBeCloseTo(3 * S.f, 6)
  })

  it('roundtrips worldToScreen ↔ screenToWorld', () => {
    const cam = new CameraNode2D()
    cam.setViewport({ x: 100, y: 200, width: 400, height: 300 })
    cam.setPixelSize(800, 600)
    const w = { x: 250, y: 350 }
    const s = cam.worldToScreen(w.x, w.y)
    const back = cam.screenToWorld(s.x, s.y)
    expect(back.x).toBeCloseTo(w.x, 5)
    expect(back.y).toBeCloseTo(w.y, 5)
  })

  it('a parented (translated) camera pans the view', () => {
    // Square world→canvas so scale is 1 and math is easy to reason about.
    const parent = new Node2D()
    const cam = new CameraNode2D()
    parent.add(cam)
    cam.setViewport({ x: 0, y: 0, width: 100, height: 100 })
    cam.setPixelSize(100, 100) // scale 1, offset 0

    // With the camera at origin, world (10,10) → screen (10,10).
    expect(cam.worldToScreen(10, 10).x).toBeCloseTo(10, 6)

    // Move the camera +50 in x: the framed region shifts, so the same world
    // point now maps 50 px to the left on screen.
    parent.transform.x = 50
    const s = cam.worldToScreen(10, 10)
    expect(s.x).toBeCloseTo(-40, 6)
    expect(s.y).toBeCloseTo(10, 6)

    // Round-trip still holds under the parent transform.
    const back = cam.screenToWorld(s.x, s.y)
    expect(back.x).toBeCloseTo(10, 5)
    expect(back.y).toBeCloseTo(10, 5)
  })

  it('recomputes the affine when the camera moves (cache keyed on world too)', () => {
    const parent = new Node2D()
    const cam = new CameraNode2D()
    parent.add(cam)
    cam.setViewport({ x: 0, y: 0, width: 100, height: 100 })
    cam.setPixelSize(100, 100)
    const before = cam.worldToScreen(0, 0).x
    parent.transform.x = 25
    const after = cam.worldToScreen(0, 0).x
    expect(after).not.toBeCloseTo(before, 3)
    expect(after).toBeCloseTo(-25, 6)
  })

  it('strokeSpaceScale accounts for camera scale (zoom), not just the fit', () => {
    const cam = new CameraNode2D()
    cam.setViewport({ x: 0, y: 0, width: 1000, height: 1000 })
    cam.setPixelSize(500, 500) // fit scale 0.5 → strokeSpaceScale 2
    expect(cam.strokeSpaceScale()).toBeCloseTo(2, 6)
    // Zoom in 2× via the node scale: composed screen scale doubles to 1, so
    // strokeSpaceScale halves to 1 (the "1 CSS px" invariant against the
    // COMPOSED affine, per S1).
    cam.zoom = 2
    expect(cam.screenPxPerWorldUnit()).toBeCloseTo(1, 6)
    expect(cam.strokeSpaceScale()).toBeCloseTo(1, 6)
  })

  it('visibleWorldRect is a conservative AABB of all 4 canvas corners', () => {
    const cam = new CameraNode2D()
    cam.setViewport({ x: 0, y: 0, width: 100, height: 100 })
    cam.setPixelSize(200, 100) // wider canvas: visible world wider than viewport
    const r = cam.visibleWorldRect()
    // scale = min(200/100, 100/100) = 1; visible world = 200x100 centered on the
    // viewport, so x spans [-50, 150].
    expect(r.width).toBeCloseTo(200, 4)
    expect(r.height).toBeCloseTo(100, 4)
    expect(r.x).toBeCloseTo(-50, 4)
    expect(r.y).toBeCloseTo(0, 4)
  })

  it('flags a degenerate (scale-0) camera instead of emitting NaN', () => {
    const cam = new CameraNode2D()
    cam.setViewport({ x: 0, y: 0, width: 100, height: 100 })
    cam.setPixelSize(100, 100)
    cam.transform.scaleX = 0 // singular world
    expect(cam.degenerate).toBe(true)
    const s = cam.worldToScreen(10, 10)
    expect(Number.isFinite(s.x)).toBe(true)
    expect(Number.isFinite(s.y)).toBe(true)
  })

  it('is leaf-only: rejects children', () => {
    const cam = new CameraNode2D()
    expect(() => cam.add(new Node2D())).toThrow(/leaf node/)
  })
})

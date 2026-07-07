import { describe, expect, it } from 'vitest'
import { Camera } from './Camera'

describe('Camera (uniform aspect-preserving fit)', () => {
  it('screenPxPerWorldUnit uses the smaller axis (contain)', () => {
    const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
    // Landscape canvas, square world → limited by height.
    cam.setPixelSize(200, 100)
    expect(cam.screenPxPerWorldUnit()).toBe(1)
    // Portrait canvas, square world → limited by width.
    cam.setPixelSize(100, 200)
    expect(cam.screenPxPerWorldUnit()).toBe(1)
    // Both dimensions doubled → scale 2.
    cam.setPixelSize(200, 200)
    expect(cam.screenPxPerWorldUnit()).toBe(2)
  })

  it('world (0,0) maps to a centered offset when canvas is wider than world', () => {
    const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
    cam.setPixelSize(200, 100) // scale=1, used=100x100, offsetX=50, offsetY=0
    const s = cam.worldToScreen(0, 0)
    expect(s.x).toBe(50)
    expect(s.y).toBe(0)
    const s2 = cam.worldToScreen(100, 100)
    expect(s2.x).toBe(150)
    expect(s2.y).toBe(100)
  })

  it('preserves aspect: a square world unit renders as a square', () => {
    const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
    cam.setPixelSize(400, 100) // world height caps scale at 1
    const a = cam.worldToScreen(0, 0)
    const b = cam.worldToScreen(10, 10)
    const dx = b.x - a.x
    const dy = b.y - a.y
    expect(dx).toBe(dy)
  })

  it('roundtrips worldToScreen ↔ screenToWorld', () => {
    const cam = new Camera({ x: 100, y: 200, width: 400, height: 300 })
    cam.setPixelSize(800, 600) // scale = min(2, 2) = 2
    const w = { x: 250, y: 350 }
    const s = cam.worldToScreen(w.x, w.y)
    const back = cam.screenToWorld(s.x, s.y)
    expect(back.x).toBeCloseTo(w.x, 5)
    expect(back.y).toBeCloseTo(w.y, 5)
  })

  it('screenToWorld degrades gracefully when pixel size is zero', () => {
    const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
    const w = cam.screenToWorld(50, 50)
    expect(w).toEqual({ x: 0, y: 0 })
  })

  it('frameNum increments on viewport or pixel-size change', () => {
    const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
    expect(cam.frameNum).toBe(0)
    cam.setPixelSize(100, 100)
    expect(cam.frameNum).toBe(1)
    cam.setPixelSize(100, 100)
    expect(cam.frameNum).toBe(1) // no-op
    cam.setViewport({ x: 10, y: 0, width: 100, height: 100 })
    expect(cam.frameNum).toBe(2)
  })

  describe('strokeSpaceScale', () => {
    it('is the reciprocal of screenPxPerWorldUnit for a valid camera', () => {
      const cam = new Camera({ x: 0, y: 0, width: 1000, height: 1000 })
      cam.setPixelSize(500, 500)
      // 500 CSS px / 1000 world units → 0.5 CSS px per world unit.
      expect(cam.screenPxPerWorldUnit()).toBe(0.5)
      expect(cam.strokeSpaceScale()).toBe(2)
    })

    it('halves when the camera zooms in (viewport shrinks)', () => {
      const cam = new Camera({ x: 0, y: 0, width: 1000, height: 1000 })
      cam.setPixelSize(500, 500)
      expect(cam.strokeSpaceScale()).toBe(2)
      // Half the viewport = 2× the world→screen scale; strokeSpaceScale
      // halves to compensate so `lineWidth × strokeSpaceScale()` renders
      // as the same CSS-px count.
      cam.setViewport({ x: 0, y: 0, width: 500, height: 500 })
      expect(cam.screenPxPerWorldUnit()).toBe(1)
      expect(cam.strokeSpaceScale()).toBe(1)
    })

    it('returns 1 when pixel size is zero (degenerate / pre-resize)', () => {
      const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
      // Freshly constructed, pixel size defaults to (0, 0).
      expect(cam.screenPxPerWorldUnit()).toBe(0)
      expect(cam.strokeSpaceScale()).toBe(1)
    })
  })

  describe('getScreenTransform caching', () => {
    it('returns the same cached object across repeated calls without mutation', () => {
      const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
      cam.setPixelSize(200, 200)
      const t1 = cam.getScreenTransform()
      const t2 = cam.getScreenTransform()
      // Same object identity, evidence of the cache.
      expect(t1).toBe(t2)
      expect(t1.scale).toBe(2)
    })

    it('recomputes when viewport changes', () => {
      const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
      cam.setPixelSize(200, 200)
      const t1 = cam.getScreenTransform()
      expect(t1.scale).toBe(2)
      cam.setViewport({ x: 0, y: 0, width: 50, height: 50 })
      const t2 = cam.getScreenTransform()
      // Same object identity (we mutate in place), but new values.
      expect(t2.scale).toBe(4)
    })

    it('recomputes when pixel size changes', () => {
      const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
      cam.setPixelSize(200, 200)
      expect(cam.getScreenTransform().scale).toBe(2)
      cam.setPixelSize(400, 400)
      expect(cam.getScreenTransform().scale).toBe(4)
    })

    it('an explicit out parameter bypasses the cache and does not touch it', () => {
      const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
      cam.setPixelSize(200, 200)
      const cached = cam.getScreenTransform()
      const out = { scale: 0, offsetX: 0, offsetY: 0 }
      const written = cam.getScreenTransform(out)
      expect(written).toBe(out)
      expect(written).not.toBe(cached)
      expect(written.scale).toBe(2)
      // Mutating the returned out does NOT poison the cache.
      out.scale = 999
      expect(cam.getScreenTransform().scale).toBe(2)
    })
  })
})

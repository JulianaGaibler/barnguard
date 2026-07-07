import { describe, expect, it } from 'vitest'
import { PolylineNode } from './PolylineNode'
import { Camera } from '../camera/Camera'
import { Canvas2DGfx } from '../render/gfx/Canvas2DGfx'

/**
 * Real camera with a known 1:1 world→screen scale, `strokeSpaceScale()` returns
 * 1, so tests can assert on the raw `lineWidth` without maths.
 */
function unitCamera(): Camera {
  const cam = new Camera({ x: 0, y: 0, width: 100, height: 100 })
  cam.setPixelSize(100, 100)
  return cam
}

describe('PolylineNode', () => {
  it('endPoint is null when empty', () => {
    const p = new PolylineNode()
    expect(p.endPoint).toBeNull()
  })

  it('push updates endPoint and pointCount', () => {
    const p = new PolylineNode()
    p.push(1, 2)
    p.push(3, 4)
    expect(p.pointCount).toBe(2)
    expect(p.endPoint).toEqual({ x: 3, y: 4 })
  })

  it('grows storage when capacity is exceeded', () => {
    const p = new PolylineNode({ capacity: 4 })
    expect(p.capacity).toBe(4)
    for (let i = 0; i < 200; i++) p.push(i, i * 2)
    expect(p.pointCount).toBe(200)
    expect(p.capacity).toBeGreaterThanOrEqual(200)
    // Sample values survived the growth.
    expect(p.pointAt(0)).toEqual({ x: 0, y: 0 })
    expect(p.pointAt(199)).toEqual({ x: 199, y: 398 })
  })

  it('pushIfFar skips points closer than the threshold', () => {
    const p = new PolylineNode()
    expect(p.pushIfFar(0, 0, 5)).toBe(true)
    expect(p.pushIfFar(1, 0, 5)).toBe(false) // dist = 1 < 5
    expect(p.pushIfFar(6, 0, 5)).toBe(true) // dist = 6 ≥ 5
    expect(p.pointCount).toBe(2)
  })

  it('clear resets pointCount and debugBounds', () => {
    const p = new PolylineNode()
    p.push(1, 2)
    p.push(3, 4)
    expect(p.debugBounds).not.toBeNull()
    p.clear()
    expect(p.pointCount).toBe(0)
    expect(p.debugBounds).toBeNull()
    expect(p.endPoint).toBeNull()
  })

  it('expands debug bounds to enclose all points', () => {
    const p = new PolylineNode()
    p.push(0, 0)
    p.push(10, 5)
    p.push(-3, 8)
    const b = p.debugBounds
    expect(b).not.toBeNull()
    if (!b) return
    expect(b.x).toBe(-3)
    expect(b.y).toBe(0)
    expect(b.width).toBe(13)
    expect(b.height).toBe(8)
  })

  it('simplify keeps endpoints and drops near-collinear middle points', () => {
    const p = new PolylineNode()
    // Nearly-straight line with mid-points that RDP should drop.
    p.push(0, 0)
    p.push(10, 0.05)
    p.push(20, -0.05)
    p.push(30, 0.02)
    p.push(40, 0)
    p.simplify(1) // tolerance of 1 world unit, should drop the middle jitter.
    expect(p.pointCount).toBe(2)
    expect(p.pointAt(0)).toEqual({ x: 0, y: 0 })
    expect(p.pointAt(1)).toEqual({ x: 40, y: 0 })
  })

  it('draw with fewer than 2 points is a no-op (does not throw)', () => {
    const p = new PolylineNode()
    // Minimal ctx stub wrapped in the Canvas2D facade the node draws through.
    const ctx = {
      beginPath() {},
      moveTo() {},
      lineTo() {},
      stroke() {},
      quadraticCurveTo() {},
      setLineDash() {},
      strokeStyle: '' as string | CanvasGradient | CanvasPattern,
      lineWidth: 1,
      lineJoin: 'round' as CanvasLineJoin,
      lineCap: 'round' as CanvasLineCap,
    }
    const gfx = new Canvas2DGfx(ctx as unknown as CanvasRenderingContext2D)
    // p.draw isn't declared on `SceneNode` mandatorily; access via optional call.
    expect(() => p.draw?.(gfx, unitCamera(), 0)).not.toThrow()
    p.push(1, 1)
    expect(() => p.draw?.(gfx, unitCamera(), 0)).not.toThrow()
  })

  it('draw with quadratic smoothing does not throw on a 5-point path', () => {
    const p = new PolylineNode({ smoothing: 'quadratic' })
    for (let i = 0; i < 5; i++) p.push(i * 10, Math.sin(i) * 5)
    let quadCount = 0
    let lineCount = 0
    const ctx = {
      beginPath() {},
      moveTo() {},
      lineTo() {
        lineCount++
      },
      quadraticCurveTo() {
        quadCount++
      },
      stroke() {},
      setLineDash() {},
      strokeStyle: '' as string | CanvasGradient | CanvasPattern,
      lineWidth: 1,
      lineJoin: 'round' as CanvasLineJoin,
      lineCap: 'round' as CanvasLineCap,
    }
    const gfx = new Canvas2DGfx(ctx as unknown as CanvasRenderingContext2D)
    p.draw?.(gfx, unitCamera(), 0)
    // With smoothing 'quadratic': at least one quadraticCurveTo was called.
    expect(quadCount).toBeGreaterThan(0)
    // First segment + last segment are lineTo calls.
    expect(lineCount).toBeGreaterThan(0)
  })

  describe('dropHead', () => {
    it('is a no-op for count <= 0', () => {
      const p = new PolylineNode()
      p.push(1, 1)
      p.push(2, 2)
      p.dropHead(0)
      p.dropHead(-5)
      expect(p.pointCount).toBe(2)
      expect(p.pointAt(0)).toEqual({ x: 1, y: 1 })
    })

    it('shifts the tail down and updates pointCount', () => {
      const p = new PolylineNode()
      p.push(1, 1)
      p.push(2, 2)
      p.push(3, 3)
      p.push(4, 4)
      p.dropHead(2)
      expect(p.pointCount).toBe(2)
      expect(p.pointAt(0)).toEqual({ x: 3, y: 3 })
      expect(p.pointAt(1)).toEqual({ x: 4, y: 4 })
    })

    it('clamps count to the current pointCount without throwing', () => {
      const p = new PolylineNode()
      p.push(1, 1)
      p.push(2, 2)
      p.dropHead(10)
      expect(p.pointCount).toBe(0)
      expect(p.endPoint).toBeNull()
    })

    it('follow-on pushes continue from the shifted tail', () => {
      const p = new PolylineNode()
      for (let i = 0; i < 5; i++) p.push(i, i)
      p.dropHead(3)
      expect(p.pointCount).toBe(2)
      p.push(99, 99)
      expect(p.pointCount).toBe(3)
      expect(p.pointAt(0)).toEqual({ x: 3, y: 3 })
      expect(p.pointAt(2)).toEqual({ x: 99, y: 99 })
    })
  })
})

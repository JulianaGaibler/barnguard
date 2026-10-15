import { describe, expect, it, vi } from 'vitest'
import { PolylineNode } from './PolylineNode'
import { paintCalls, paintPicture } from '../render/picture/paintCalls'
import type { GfxStrokeStyle } from '../render/gfx/Gfx2D'

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

  it('clear resets pointCount and the endpoint', () => {
    const p = new PolylineNode()
    p.push(1, 2)
    p.push(3, 4)
    p.clear()
    expect(p.pointCount).toBe(0)
    expect(p.endPoint).toBeNull()
  })

  it('paints a picture whose bounds enclose all points', () => {
    const p = new PolylineNode()
    p.push(0, 0)
    p.push(10, 5)
    p.push(-3, 8)
    const b = paintPicture(p).bounds
    expect(b).not.toBeNull()
    if (!b) return
    expect(b.x).toBeLessThanOrEqual(-3)
    expect(b.y).toBeLessThanOrEqual(0)
    expect(b.x + b.width).toBeGreaterThanOrEqual(10)
    expect(b.y + b.height).toBeGreaterThanOrEqual(8)
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

  /** The `strokePolyline` calls the node paints. */
  function strokes(
    p: PolylineNode,
  ): { count: number; style: GfxStrokeStyle }[] {
    return paintCalls(p)
      .filter((c) => c.name === 'strokePolyline')
      .map((c) => ({
        count: c.args[1] as number,
        style: c.args[2] as GfxStrokeStyle,
      }))
  }

  it('paints nothing with fewer than 2 points', () => {
    const p = new PolylineNode()
    expect(strokes(p)).toHaveLength(0)
    p.push(1, 1)
    expect(strokes(p)).toHaveLength(0)
  })

  it('paints with quadratic smoothing forwarding the smoothing style and point count', () => {
    const p = new PolylineNode({ smoothing: 'quadratic' })
    for (let i = 0; i < 5; i++) p.push(i * 10, Math.sin(i) * 5)
    const calls = strokes(p)
    expect(calls).toHaveLength(1)
    expect(calls[0].count).toBe(5)
    expect(calls[0].style.smoothing).toBe('quadratic')
  })

  it('repaints when a point is added, changed or dropped', () => {
    const p = new PolylineNode()
    const dirty = vi.spyOn(p, 'markNeedsPaint')
    p.push(0, 0)
    p.push(5, 5)
    p.setPoint(0, 1, 1)
    p.dropHead(1)
    p.clear()
    expect(dirty).toHaveBeenCalledTimes(5)
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

  describe('fluent API', () => {
    it('push chains and appends in order', () => {
      const p = new PolylineNode()
      const ret = p.push(0, 0).push(10, 4).push(20, 9)
      expect(ret).toBe(p)
      expect(p.pointCount).toBe(3)
      expect(p.pointAt(2)).toEqual({ x: 20, y: 9 })
    })

    it('clear / dropHead / setPoint return this', () => {
      const p = new PolylineNode()
      p.push(0, 0).push(1, 1).push(2, 2)
      expect(p.setPoint(0, 5, 5)).toBe(p)
      expect(p.pointAt(0)).toEqual({ x: 5, y: 5 })
      expect(p.dropHead(1)).toBe(p)
      expect(p.pointCount).toBe(2)
      expect(p.clear()).toBe(p)
      expect(p.pointCount).toBe(0)
    })
  })
})

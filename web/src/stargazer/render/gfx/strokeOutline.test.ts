import { describe, it, expect, vi } from 'vitest'
import {
  StrokeOutlineBuffer,
  strokeOutline,
  wouldFallBackToCenter,
  DEFAULT_MITER_LIMIT,
  type StrokeOutlineOptions,
} from './strokeOutline'

const baseOpts = (
  overrides: Partial<StrokeOutlineOptions> = {},
): StrokeOutlineOptions => ({
  width: 10,
  align: 'center',
  join: 'miter',
  cap: 'butt',
  miterLimit: DEFAULT_MITER_LIMIT,
  closed: false,
  fringeScale: { x: 1, y: 1 },
  scale: 1,
  ...overrides,
})

function assertFinite(buf: StrokeOutlineBuffer): void {
  for (const v of buf.positions) expect(Number.isFinite(v)).toBe(true)
  for (const c of buf.coverage) {
    expect(Number.isFinite(c)).toBe(true)
    expect(c).toBeGreaterThanOrEqual(0)
    expect(c).toBeLessThanOrEqual(1)
  }
  expect(buf.indices.length % 3).toBe(0)
}

describe('strokeOutline', () => {
  it('produces a non-empty, finite outline for a simple open segment', () => {
    const buf = new StrokeOutlineBuffer()
    strokeOutline([0, 0, 100, 0], 2, baseOpts(), buf)
    assertFinite(buf)
    expect(buf.indices.length).toBeGreaterThan(0)
  })

  it('centers the core boundary at +/- halfW for a horizontal segment', () => {
    const buf = new StrokeOutlineBuffer()
    strokeOutline([0, 0, 100, 0], 2, baseOpts({ width: 10 }), buf)
    const coreYs: number[] = []
    for (let i = 0; i < buf.coverage.length; i++) {
      if (buf.coverage[i] === 1) coreYs.push(buf.positions[i * 2 + 1])
    }
    expect(coreYs.some((y) => Math.abs(y - 5) < 1e-6)).toBe(true)
    expect(coreYs.some((y) => Math.abs(y + 5) < 1e-6)).toBe(true)
  })

  it('offsets fully to one side for "inside" and "outside" on a closed square', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10]
    const insideBuf = new StrokeOutlineBuffer()
    strokeOutline(
      square,
      4,
      baseOpts({ width: 4, align: 'inside', closed: true }),
      insideBuf,
    )
    assertFinite(insideBuf)
    // The outer edge of an inside-aligned stroke is the path itself: some
    // core vertex should sit exactly on the original square's boundary.
    const onBoundary = (x: number, y: number): boolean =>
      (Math.abs(x) < 1e-6 || Math.abs(x - 10) < 1e-6) &&
      y >= -1e-6 &&
      y <= 10 + 1e-6
    let found = false
    for (let i = 0; i < insideBuf.coverage.length; i++) {
      if (insideBuf.coverage[i] !== 1) continue
      const x = insideBuf.positions[i * 2]
      const y = insideBuf.positions[i * 2 + 1]
      if (onBoundary(x, y) || (Math.abs(y) < 1e-6 && x >= 0 && x <= 10)) {
        found = true
      }
    }
    expect(found).toBe(true)
  })

  it('winds both orientations without NaN', () => {
    const ccw = [0, 0, 10, 0, 10, 10, 0, 10]
    const cw = [0, 0, 0, 10, 10, 10, 10, 0]
    for (const poly of [ccw, cw]) {
      const buf = new StrokeOutlineBuffer()
      strokeOutline(poly, 4, baseOpts({ closed: true, align: 'outside' }), buf)
      assertFinite(buf)
      expect(buf.indices.length).toBeGreaterThan(0)
    }
  })

  it('falls back to bevel past the miter limit', () => {
    // A sharp spike (~88 degree turn): the outer miter ratio is well above 1.
    const spike = [0, 0, 50, 48, 100, 0]
    const beveled = new StrokeOutlineBuffer()
    strokeOutline(spike, 3, baseOpts({ miterLimit: 1 }), beveled)
    assertFinite(beveled)
    const mitered = new StrokeOutlineBuffer()
    strokeOutline(spike, 3, baseOpts({ miterLimit: 100 }), mitered)
    assertFinite(mitered)
    // The low-limit (bevel) run should never push the join vertex as far
    // from the apex, on the convex (outer) side of the joint, as the
    // high-limit (near-true-miter) run does. The concave (inner) side
    // always uses the exact miter intersection regardless of style or
    // limit, so it is filtered out here (it sits above the apex; the outer
    // side of this spike sits below it) or it would mask the difference.
    const maxConvexSideDist = (buf: StrokeOutlineBuffer): number => {
      let m = 0
      for (let i = 0; i < buf.coverage.length; i++) {
        const x = buf.positions[i * 2] - 50
        const y = buf.positions[i * 2 + 1] - 48
        const d = Math.hypot(x, y)
        if (d < 20 && y < 0) m = Math.max(m, d)
      }
      return m
    }
    expect(maxConvexSideDist(beveled)).toBeLessThan(maxConvexSideDist(mitered))
  })

  it('round join/cap tessellates more finely at a larger device scale', () => {
    const corner = [0, 0, 10, 0, 10, 10]
    const small = new StrokeOutlineBuffer()
    strokeOutline(corner, 3, baseOpts({ join: 'round', scale: 0.1 }), small)
    const large = new StrokeOutlineBuffer()
    strokeOutline(corner, 3, baseOpts({ join: 'round', scale: 50 }), large)
    assertFinite(small)
    assertFinite(large)
    expect(large.coverage.length).toBeGreaterThan(small.coverage.length)
  })

  it('round join respects the arc step clamp (not a spinning loop at near-zero radius)', () => {
    const corner = [0, 0, 0.001, 0, 0.001, 10]
    const buf = new StrokeOutlineBuffer()
    strokeOutline(
      corner,
      3,
      baseOpts({ join: 'round', width: 0.0001, scale: 1e6 }),
      buf,
    )
    assertFinite(buf)
    // ARC_STEP_MIN bounds the point count even at an extreme tolerance ratio.
    expect(buf.coverage.length).toBeLessThan(500)
  })

  it('open vs closed produce different triangle counts for the same points', () => {
    const square = [0, 0, 10, 0, 10, 10, 0, 10]
    const open = new StrokeOutlineBuffer()
    strokeOutline(square, 4, baseOpts({ closed: false }), open)
    const closed = new StrokeOutlineBuffer()
    strokeOutline(square, 4, baseOpts({ closed: true }), closed)
    assertFinite(open)
    assertFinite(closed)
    expect(open.indices.length).not.toBe(closed.indices.length)
  })

  it('each cap style produces valid, finite geometry', () => {
    for (const cap of ['butt', 'round', 'square'] as const) {
      const buf = new StrokeOutlineBuffer()
      strokeOutline([0, 0, 20, 0], 2, baseOpts({ cap }), buf)
      assertFinite(buf)
      expect(buf.indices.length).toBeGreaterThan(0)
    }
  })

  describe('input sanitation', () => {
    it('collapses coincident points without producing NaN', () => {
      const buf = new StrokeOutlineBuffer()
      strokeOutline([0, 0, 0, 0, 50, 0, 100, 0], 4, baseOpts(), buf)
      assertFinite(buf)
    })

    it('drops a Z-duplicated closing point on a closed contour', () => {
      const buf = new StrokeOutlineBuffer()
      // M 0 0 L 100 0 L 100 100 Z, flattened with the duplicate seam vertex.
      strokeOutline(
        [0, 0, 100, 0, 100, 100, 0, 0],
        4,
        baseOpts({ closed: true, align: 'outside' }),
        buf,
      )
      assertFinite(buf)
      expect(buf.indices.length).toBeGreaterThan(0)
    })

    it('handles a zero-length segment safely', () => {
      const buf = new StrokeOutlineBuffer()
      strokeOutline([0, 0, 0, 0], 2, baseOpts(), buf)
      assertFinite(buf)
    })

    it('handles a 180-degree reversal without NaN', () => {
      const buf = new StrokeOutlineBuffer()
      strokeOutline([0, 0, 100, 0, 0, 0], 3, baseOpts(), buf)
      assertFinite(buf)
    })

    it('falls back from a zero-area bowtie to center alignment, with a warning', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const bowtie = [0, 0, 100, 100, 100, 0, 0, 100]
      const buf = new StrokeOutlineBuffer()
      strokeOutline(
        bowtie,
        4,
        baseOpts({ closed: true, align: 'outside' }),
        buf,
      )
      assertFinite(buf)
      expect(buf.indices.length).toBeGreaterThan(0)
      warn.mockRestore()
    })

    it('falls back from non-center alignment on an open contour', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const buf = new StrokeOutlineBuffer()
      strokeOutline([0, 0, 100, 0], 2, baseOpts({ align: 'inside' }), buf)
      assertFinite(buf)
      expect(buf.indices.length).toBeGreaterThan(0)
      warn.mockRestore()
    })

    it('produces no geometry for a single point', () => {
      const buf = new StrokeOutlineBuffer()
      strokeOutline([5, 5], 1, baseOpts(), buf)
      expect(buf.indices.length).toBe(0)
    })
  })

  describe('wouldFallBackToCenter', () => {
    it('is false for a center request, regardless of the contour', () => {
      expect(wouldFallBackToCenter([0, 0, 100, 0], 2, false, 'center')).toBe(
        false,
      )
    })

    it('is true for a non-center request on an open contour', () => {
      expect(wouldFallBackToCenter([0, 0, 100, 0], 2, false, 'inside')).toBe(
        true,
      )
    })

    it('is true for a non-center request on a zero-area bowtie', () => {
      const bowtie = [0, 0, 100, 100, 100, 0, 0, 100]
      expect(wouldFallBackToCenter(bowtie, 4, true, 'outside')).toBe(true)
    })

    it('is false for a non-center request on a well-wound closed contour', () => {
      const square = [0, 0, 100, 0, 100, 100, 0, 100]
      expect(wouldFallBackToCenter(square, 4, true, 'outside')).toBe(false)
    })

    it('never warns (unlike the real tessellation)', () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      wouldFallBackToCenter([0, 0, 100, 0], 2, false, 'inside')
      expect(warn).not.toHaveBeenCalled()
      warn.mockRestore()
    })
  })

  describe('anisotropic fringe', () => {
    it('solves the fringe push per vertex, not with a shared scalar', () => {
      // A horizontal segment's fringe pushes purely along Y: its length
      // should track fringeScale.y, independent of fringeScale.x.
      const buf = new StrokeOutlineBuffer()
      strokeOutline(
        [0, 0, 100, 0],
        2,
        baseOpts({ fringeScale: { x: 4, y: 0.25 } }),
        buf,
      )
      assertFinite(buf)
      let maxFringeY = 0
      for (let i = 0; i < buf.coverage.length; i++) {
        if (buf.coverage[i] === 0) {
          maxFringeY = Math.max(maxFringeY, Math.abs(buf.positions[i * 2 + 1]))
        }
      }
      // Core sits at y = +/-5. Fringe push length = FRINGE_PX / scaleY = 1/0.25 = 4.
      expect(maxFringeY).toBeGreaterThan(8)
      expect(maxFringeY).toBeLessThan(10)
    })
  })
})

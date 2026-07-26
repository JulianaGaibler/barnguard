import { describe, expect, it } from 'vitest'
import { classifyGesture } from './input'

const OPTS = { minSpan: 44, maxSpan: 380, angleTolDeg: 28 }

describe('jezzball gesture classification', () => {
  it('reads horizontally-spread fingers as a horizontal wall', () => {
    const r = classifyGesture({ x: 0, y: 0 }, { x: 100, y: 0 }, OPTS)
    expect(r?.orientation).toBe('horizontal')
    expect(r?.mid).toEqual({ x: 50, y: 0 })
  })

  it('reads vertically-stacked fingers as a vertical wall', () => {
    const r = classifyGesture({ x: 0, y: 0 }, { x: 0, y: 100 }, OPTS)
    expect(r?.orientation).toBe('vertical')
    expect(r?.mid).toEqual({ x: 0, y: 50 })
  })

  it('builds nothing in the ambiguous diagonal band', () => {
    expect(classifyGesture({ x: 0, y: 0 }, { x: 80, y: 80 }, OPTS)).toBeNull()
  })

  it('rejects fingers too far apart or too close', () => {
    expect(classifyGesture({ x: 0, y: 0 }, { x: 1000, y: 0 }, OPTS)).toBeNull()
    expect(classifyGesture({ x: 0, y: 0 }, { x: 10, y: 0 }, OPTS)).toBeNull()
  })

  it('accepts slight tilt within tolerance', () => {
    // ~20° from horizontal → horizontal.
    expect(
      classifyGesture({ x: 0, y: 0 }, { x: 100, y: 36 }, OPTS)?.orientation,
    ).toBe('horizontal')
    // ~75° from horizontal → vertical.
    expect(
      classifyGesture({ x: 0, y: 0 }, { x: 27, y: 100 }, OPTS)?.orientation,
    ).toBe('vertical')
  })

  it('rejects tilt just outside the tolerance band', () => {
    // ~35° from horizontal is neither horizontal (<=28) nor vertical (>=62).
    expect(classifyGesture({ x: 0, y: 0 }, { x: 100, y: 70 }, OPTS)).toBeNull()
  })

  it('is direction-agnostic (folds the angle)', () => {
    // Fingers placed right-to-left still read horizontal.
    expect(
      classifyGesture({ x: 100, y: 0 }, { x: 0, y: 0 }, OPTS)?.orientation,
    ).toBe('horizontal')
  })
})

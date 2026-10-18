import { describe, expect, it } from 'vitest'
import { LINK_LENGTH, MARK_SIZE, trailGeometry } from './progressTrail'
import type { ProgressMark } from '../story/run'

function marks(n: number): ProgressMark[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: i % 3 === 2 ? 'moment' : 'step',
    current: i === n - 1,
  }))
}

describe('trailGeometry', () => {
  it('lays marks out with links between them', () => {
    const g = trailGeometry(marks(3), 1664)
    expect(g.marks.map((m) => m.x)).toEqual([0, 52, 104])
    expect(g.links).toEqual([
      { x1: 36, x2: 52 },
      { x1: 88, x2: 104 },
    ])
    expect(g.naturalWidth).toBe(3 * MARK_SIZE + 2 * LINK_LENGTH)
    expect(g.width).toBe(g.naturalWidth)
    expect(g.height).toBe(MARK_SIZE)
  })

  it('matches the mockup row of six', () => {
    expect(trailGeometry(marks(6), 1664).width).toBe(296)
  })

  it('scales a long run down to the row', () => {
    const g = trailGeometry(marks(40), 1664)
    expect(g.naturalWidth).toBeGreaterThan(1664)
    expect(g.width).toBeCloseTo(1664)
    expect(g.height).toBeLessThan(MARK_SIZE)
  })

  it('keeps thirty marks at full size', () => {
    expect(trailGeometry(marks(30), 1664).height).toBe(MARK_SIZE)
  })

  it('draws nothing for no marks', () => {
    const g = trailGeometry([], 1664)
    expect(g.width).toBe(0)
    expect(g.links).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import {
  LINK_LENGTH,
  MARK_SIZE,
  trailGeometry,
  markSlot,
} from './progressTrail'
import type { ProgressMark } from '../story/run'

function marks(n: number): ProgressMark[] {
  return Array.from({ length: n }, (_, i) => ({
    kind: i % 3 === 2 ? 'choice' : 'scene',
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

  it('is as wide as five marks at most', () => {
    expect(trailGeometry(marks(5), 1664).width).toBe(244)
    expect(trailGeometry(marks(6), 1664).width).toBe(244)
    expect(trailGeometry(marks(40), 1664).width).toBe(244)
  })

  it('scales the five in view down to a narrow row', () => {
    const g = trailGeometry(marks(40), 122)
    expect(g.width).toBeCloseTo(122)
    expect(g.height).toBeLessThan(MARK_SIZE)
  })

  it('keeps a long run at full size', () => {
    expect(trailGeometry(marks(30), 1664).height).toBe(MARK_SIZE)
  })

  it('draws nothing for no marks', () => {
    const g = trailGeometry([], 1664)
    expect(g.width).toBe(0)
    expect(g.links).toEqual([])
  })
})

describe('markSlot', () => {
  it('centers the first mark half a mark in', () => {
    expect(markSlot(1, 0, 1664)).toEqual({ x: 18, y: 18, size: 36 })
  })

  it('steps one mark and one link along the row', () => {
    expect(markSlot(3, 2, 1664).x - markSlot(3, 1, 1664).x).toBe(52)
  })

  it('scales with the row when it outgrows its width', () => {
    const slot = markSlot(60, 59, 122)
    expect(slot.size).toBeCloseTo(36 * (122 / 244))
    // The last mark's far edge is at the row's width.
    expect(slot.x + slot.size / 2).toBeCloseTo(122)
  })

  it('puts the newest mark at the fifth place once the row scrolls', () => {
    expect(markSlot(6, 5, 1664).x).toBe(markSlot(5, 4, 1664).x)
    expect(markSlot(40, 39, 1664).x).toBe(4 * 52 + 18)
  })

  it('agrees with the geometry the row is drawn from', () => {
    const marks = Array.from({ length: 5 }, (_, i) => ({
      kind: 'scene' as const,
      current: i === 4,
    }))
    const geometry = trailGeometry(marks, 1664)
    const slot = markSlot(5, 4, 1664)
    expect(geometry.marks[4].x + 18).toBe(slot.x)
  })
})

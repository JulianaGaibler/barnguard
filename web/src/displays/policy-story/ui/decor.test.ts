import { describe, expect, it } from 'vitest'
import { blendShapes, type DecorShape } from './decor'

const box = (x: number, field = 0): DecorShape => ({
  shape: 'rect',
  field,
  x,
  y: 0.5,
  w: 0.2,
  h: 0.2,
})

describe('blendShapes', () => {
  it('is the first list at 0 and the second at 1', () => {
    const a = [box(0.1)]
    const b = [box(0.9)]
    expect(blendShapes(a, b, 0)).toBe(a)
    expect(blendShapes(a, b, 1)).toBe(b)
  })

  it('fades the old shapes out and the new ones in without moving any', () => {
    const mid = blendShapes([box(0.1)], [box(0.9)], 0.25)
    expect(mid.map((s) => s.x)).toEqual([0.1, 0.9])
    expect(mid[0]!.tone).toBeCloseTo(0.75)
    expect(mid[1]!.tone).toBeCloseTo(0.25)
  })
})

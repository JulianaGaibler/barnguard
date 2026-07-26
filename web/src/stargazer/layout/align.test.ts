import { describe, expect, it } from 'vitest'
import { alignOffset, alignWithin } from './align'
import { rect } from '../math/Rect'

describe('alignOffset', () => {
  it('places a child along one axis by its free space', () => {
    expect(alignOffset('start', 40)).toBe(0)
    expect(alignOffset('center', 40)).toBe(20)
    expect(alignOffset('end', 40)).toBe(40)
  })
  it('treats stretch like start (it returns an offset, not a size)', () => {
    expect(alignOffset('stretch', 40)).toBe(0)
  })
})

describe('alignWithin', () => {
  const container = rect(100, 200, 400, 300)

  it('centers a box on both axes', () => {
    expect(alignWithin(container, 100, 60, 'center', 'center')).toEqual({
      x: 250,
      y: 320,
    })
  })

  it('pins to the start and end corners', () => {
    expect(alignWithin(container, 100, 60, 'start', 'start')).toEqual({
      x: 100,
      y: 200,
    })
    expect(alignWithin(container, 100, 60, 'end', 'end')).toEqual({
      x: 400,
      y: 440,
    })
  })

  it('aligns each axis independently', () => {
    expect(alignWithin(container, 100, 60, 'end', 'start')).toEqual({
      x: 400,
      y: 200,
    })
  })
})

import { describe, expect, it } from 'vitest'
import { classifySwipe } from './input'

const MIN = { minDistance: 50 }

describe('classifySwipe', () => {
  it('reads the dominant axis', () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 100, y: 10 }, MIN)).toBe('right')
    expect(classifySwipe({ x: 0, y: 0 }, { x: -100, y: 10 }, MIN)).toBe('left')
    expect(classifySwipe({ x: 0, y: 0 }, { x: 10, y: 100 }, MIN)).toBe('down')
    expect(classifySwipe({ x: 0, y: 0 }, { x: 10, y: -100 }, MIN)).toBe('up')
  })

  it('resolves an exact diagonal horizontally', () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 80, y: 80 }, MIN)).toBe('right')
    expect(classifySwipe({ x: 0, y: 0 }, { x: -80, y: -80 }, MIN)).toBe('left')
  })

  it('rejects a drag shorter than the threshold', () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 40, y: 40 }, MIN)).toBeNull()
    expect(classifySwipe({ x: 0, y: 0 }, { x: 0, y: 0 }, MIN)).toBeNull()
  })

  it('accepts a drag that is long enough on either axis alone', () => {
    expect(classifySwipe({ x: 0, y: 0 }, { x: 50, y: 0 }, MIN)).toBe('right')
    expect(classifySwipe({ x: 0, y: 0 }, { x: 0, y: 50 }, MIN)).toBe('down')
  })

  it('measures from the start, not from the origin', () => {
    expect(classifySwipe({ x: 900, y: 400 }, { x: 800, y: 405 }, MIN)).toBe(
      'left',
    )
  })
})

import { describe, expect, it } from 'vitest'
import { formatElapsed } from './formatElapsed'

describe('formatElapsed', () => {
  it('reads minutes and padded seconds', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(5)).toBe('0:05')
    expect(formatElapsed(48)).toBe('0:48')
    expect(formatElapsed(60)).toBe('1:00')
    expect(formatElapsed(125)).toBe('2:05')
  })

  it('lets the minutes run past an hour', () => {
    expect(formatElapsed(3661)).toBe('61:01')
  })

  it('drops partial seconds instead of rounding up', () => {
    expect(formatElapsed(59.9)).toBe('0:59')
    expect(formatElapsed(0.99)).toBe('0:00')
  })

  it('reads a negative or non-finite duration as zero', () => {
    expect(formatElapsed(-3)).toBe('0:00')
    expect(formatElapsed(Number.NaN)).toBe('0:00')
    expect(formatElapsed(Infinity)).toBe('0:00')
  })
})

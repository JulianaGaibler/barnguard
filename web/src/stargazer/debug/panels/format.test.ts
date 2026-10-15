import { describe, expect, it } from 'vitest'
import { bytesQuantity, fmtBytes, fmtCount, fmtPct, msQuantity } from './format'

describe('bytesQuantity', () => {
  it('stays in bytes below a kilobyte', () => {
    expect(bytesQuantity(900)).toEqual({ text: '900', unit: 'B' })
  })

  it('moves up a unit at 1024 of the smaller one', () => {
    expect(fmtBytes(1023)).toBe('1023 B')
    expect(fmtBytes(1024)).toBe('1.00 KB')
    expect(fmtBytes(1024 * 1024 - 1)).toBe('1024 KB')
    expect(fmtBytes(1024 * 1024)).toBe('1.00 MB')
    expect(fmtBytes(1024 ** 3)).toBe('1.00 GB')
  })

  it('keeps about three significant digits', () => {
    expect(fmtBytes(12.4 * 1024)).toBe('12.4 KB')
    expect(fmtBytes(123.4 * 1024 * 1024)).toBe('123 MB')
  })
})

describe('countQuantity', () => {
  it('shortens from ten thousand', () => {
    expect(fmtCount(9999)).toBe('9999')
    expect(fmtCount(12_400)).toBe('12.4 k')
    expect(fmtCount(2_500_000)).toBe('2.50 M')
  })
})

describe('msQuantity and fmtPct', () => {
  it('moves to seconds at a thousand milliseconds', () => {
    expect(msQuantity(16.7)).toEqual({ text: '16.7', unit: 'ms' })
    expect(msQuantity(2500)).toEqual({ text: '2.50', unit: 's' })
  })

  it('writes a ratio as a percentage', () => {
    expect(fmtPct(0.5)).toBe('50.0 %')
    expect(fmtPct(1)).toBe('100 %')
  })
})

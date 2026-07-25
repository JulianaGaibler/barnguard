import { describe, expect, it } from 'vitest'
import { ShelfPacker } from './ShelfPacker'

describe('ShelfPacker', () => {
  it('packs boxes left-to-right on one shelf when heights bucket together', () => {
    const p = new ShelfPacker(100, 100, 4)
    const a = p.pack(20, 10)
    const b = p.pack(30, 9) // buckets to the same 12px shelf height
    expect(a).toEqual({ x: 0, y: 0 })
    expect(b).toEqual({ x: 20, y: 0 })
  })

  it('opens a new shelf when a box is a different height bucket', () => {
    const p = new ShelfPacker(100, 100, 4)
    p.pack(20, 10) // shelf 0, height 12
    const tall = p.pack(20, 30) // shelf 1, height 32
    expect(tall).toEqual({ x: 0, y: 12 })
  })

  it('opens a new shelf when the current one is full width', () => {
    const p = new ShelfPacker(50, 100, 4)
    const a = p.pack(40, 10)
    const b = p.pack(20, 10) // doesn't fit remaining 10px → new shelf
    expect(a).toEqual({ x: 0, y: 0 })
    expect(b).toEqual({ x: 0, y: 12 })
  })

  it('reuses a freed interior span for a box that fits', () => {
    const p = new ShelfPacker(100, 100, 4)
    const a = p.pack(20, 10)! // x 0..20
    p.pack(20, 10) // x 20..40
    p.free(a.x, a.y, 20) // free the first span
    const c = p.pack(15, 10) // fits in the freed [0,20) span
    expect(c).toEqual({ x: 0, y: 0 })
  })

  it('pulls the cursor back when the rightmost span is freed', () => {
    const p = new ShelfPacker(100, 100, 4)
    p.pack(20, 10) // x 0..20
    const b = p.pack(30, 10)! // x 20..50, rightmost
    p.free(b.x, b.y, 30) // cursor should return to 20
    const c = p.pack(30, 10)
    expect(c).toEqual({ x: 20, y: 0 })
  })

  it('coalesces adjacent freed spans into one reusable span', () => {
    const p = new ShelfPacker(100, 100, 4)
    const a = p.pack(20, 10)! // 0..20
    const b = p.pack(20, 10)! // 20..40
    p.pack(20, 10) // 40..60 keeps them interior
    p.free(a.x, a.y, 20)
    p.free(b.x, b.y, 20) // now [0,40) is one span
    const wide = p.pack(35, 10)
    expect(wide).toEqual({ x: 0, y: 0 })
  })

  it('returns null when the page is full', () => {
    const p = new ShelfPacker(50, 20, 4)
    expect(p.pack(50, 10)).toEqual({ x: 0, y: 0 }) // shelf 0, height 12
    // A second shelf would need y = 12 + 12 = 24 > 20, so it can't open, and
    // shelf 0 has no width left.
    expect(p.pack(50, 10)).toBeNull()
  })

  it('rejects a box wider than the page', () => {
    const p = new ShelfPacker(50, 100, 4)
    expect(p.pack(60, 10)).toBeNull()
  })

  it('repacks from the origin after reset', () => {
    const p = new ShelfPacker(100, 100, 4)
    p.pack(40, 10)
    p.pack(40, 30)
    p.reset()
    expect(p.pack(10, 10)).toEqual({ x: 0, y: 0 })
  })
})

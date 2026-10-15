import { describe, expect, it } from 'vitest'
import { RingSeries, foldWorst } from './RingSeries'

describe('RingSeries', () => {
  it('reads samples oldest to newest, before and after wrapping', () => {
    const s = new RingSeries(3)
    const out = new Float32Array(3)
    s.push(1)
    s.push(2)
    expect(s.readOrdered(out)).toBe(2)
    expect([...out.slice(0, 2)]).toEqual([1, 2])
    s.push(3)
    s.push(4)
    expect(s.readOrdered(out)).toBe(3)
    expect([...out]).toEqual([2, 3, 4])
    expect(s.last).toBe(4)
    expect(s.peak).toBe(4)
  })

  it('reports empty as zeros', () => {
    const s = new RingSeries(3)
    expect(s.count).toBe(0)
    expect(s.last).toBe(0)
    expect(s.peak).toBe(0)
    expect(s.readOrdered(new Float32Array(3))).toBe(0)
  })
})

describe('foldWorst', () => {
  it('keeps the largest sample of each column so a spike survives', () => {
    const src = new Float32Array([1, 9, 2, 2, 3, 1])
    const out = new Float32Array(3)
    expect(foldWorst(src, 6, 3, out)).toBe(3)
    expect([...out]).toEqual([9, 2, 3])
  })

  it('gives one column per sample when there are fewer samples than columns', () => {
    const out = new Float32Array(10)
    expect(foldWorst(new Float32Array([4, 5]), 2, 10, out)).toBe(2)
    expect([...out.slice(0, 2)]).toEqual([4, 5])
  })
})

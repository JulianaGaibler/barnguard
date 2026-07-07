import { describe, expect, it } from 'vitest'
import { FrameStats } from './FrameStats'

describe('FrameStats', () => {
  it('reports zeros when empty', () => {
    const s = new FrameStats(10)
    const p = s.percentiles()
    expect(p).toEqual({ p50: 0, p95: 0, p99: 0, max: 0, count: 0 })
  })

  it('computes percentiles from a monotonic sample', () => {
    const s = new FrameStats(100)
    for (let i = 1; i <= 100; i++) s.push(i / 1000) // 1ms to 100ms
    const p = s.percentiles()
    expect(p.count).toBe(100)
    // With 100 samples, floor(100 * 0.5) = 50 → sorted[50] = 51ms.
    expect(p.p50).toBeCloseTo(0.051, 6)
    expect(p.p95).toBeCloseTo(0.096, 6)
    expect(p.p99).toBeCloseTo(0.1, 6)
    expect(p.max).toBeCloseTo(0.1, 6)
  })

  it('rings around at capacity, only the last N samples count', () => {
    const s = new FrameStats(10)
    for (let i = 0; i < 15; i++) s.push(i)
    const p = s.percentiles()
    expect(p.count).toBe(10)
    // Last 10 samples are [5..14]. Sorted, p50 = pick(0.5) = sorted[5] = 10.
    expect(p.p50).toBe(10)
    expect(p.max).toBe(14)
  })

  it('clear resets counts and returns zeros', () => {
    const s = new FrameStats(10)
    for (let i = 0; i < 5; i++) s.push(0.016)
    s.clear()
    const p = s.percentiles()
    expect(p.count).toBe(0)
    expect(p.p50).toBe(0)
  })

  it('handles a single sample', () => {
    const s = new FrameStats(10)
    s.push(0.0166)
    const p = s.percentiles()
    expect(p.count).toBe(1)
    expect(p.p50).toBeCloseTo(0.0166, 6)
    expect(p.p95).toBeCloseTo(0.0166, 6)
    expect(p.p99).toBeCloseTo(0.0166, 6)
    expect(p.max).toBeCloseTo(0.0166, 6)
  })

  it('readOrdered returns samples oldest-to-newest before wrap', () => {
    const s = new FrameStats(10)
    for (let i = 1; i <= 5; i++) s.push(i)
    const out = new Float32Array(10)
    const n = s.readOrdered(out)
    expect(n).toBe(5)
    expect(Array.from(out.subarray(0, 5))).toEqual([1, 2, 3, 4, 5])
  })

  it('readOrdered returns samples oldest-to-newest after wrap', () => {
    const s = new FrameStats(4)
    for (let i = 1; i <= 7; i++) s.push(i) // last 4 are [4, 5, 6, 7]
    const out = new Float32Array(4)
    const n = s.readOrdered(out)
    expect(n).toBe(4)
    expect(Array.from(out)).toEqual([4, 5, 6, 7])
  })

  it('readOrdered clamps to the shorter of buffer length and count', () => {
    const s = new FrameStats(10)
    for (let i = 1; i <= 6; i++) s.push(i)
    const out = new Float32Array(3)
    const n = s.readOrdered(out)
    expect(n).toBe(3)
    expect(Array.from(out)).toEqual([1, 2, 3])
  })

  it('readOrdered returns 0 when empty', () => {
    const s = new FrameStats(10)
    const out = new Float32Array(5)
    expect(s.readOrdered(out)).toBe(0)
  })
})

import { describe, expect, it } from 'vitest'
import { DashBuffer } from './dash'

const line = new Float32Array([0, 0, 100, 0])

function dashes(b: DashBuffer): number[][] {
  const out: number[][] = []
  for (let d = 0; d < b.dashCount; d++) {
    out.push(
      Array.from(b.points.subarray(b.starts[d] * 2, b.starts[d + 1] * 2)),
    )
  }
  return out
}

describe('DashBuffer', () => {
  it('cuts a line into dashes and honors the offset', () => {
    const b = new DashBuffer()
    b.cut(line, 0, 2, false, [10, 10], 0)
    expect(dashes(b)).toEqual([
      [0, 0, 10, 0],
      [20, 0, 30, 0],
      [40, 0, 50, 0],
      [60, 0, 70, 0],
      [80, 0, 90, 0],
    ])
    b.clear()
    b.cut(line, 0, 2, false, [10, 10], 5)
    expect(dashes(b)[0]).toEqual([0, 0, 5, 0])
    expect(dashes(b)[1]).toEqual([15, 0, 25, 0])
    b.clear()
    b.cut(line, 0, 2, false, [10, 10], -5)
    expect(dashes(b)[0]).toEqual([5, 0, 15, 0])
  })

  it('repeats an odd pattern and follows corners', () => {
    const b = new DashBuffer()
    b.cut(line, 0, 2, false, [30], 0)
    // 30 on, 30 off, 30 on, 30 off (odd pattern doubles).
    expect(dashes(b).map((d) => d[0])).toEqual([0, 60])
    b.clear()
    const bend = new Float32Array([0, 0, 10, 0, 10, 10])
    b.cut(bend, 0, 3, false, [15, 100], 0)
    expect(dashes(b)).toEqual([[0, 0, 10, 0, 10, 5]])
  })

  it('joins the dash across the closing point of a closed contour', () => {
    const b = new DashBuffer()
    const square = new Float32Array([0, 0, 10, 0, 10, 10, 0, 10])
    // Perimeter 40, pattern 25 on 5 off: starts on and ends on.
    b.cut(square, 0, 4, true, [25, 5], 0)
    expect(b.dashCount).toBe(1)
    expect(dashes(b)[0]).toEqual([0, 10, 0, 0, 10, 0, 10, 10, 5, 10])
  })

  it('keeps the contour whole for an unusable pattern', () => {
    const b = new DashBuffer()
    b.cut(line, 0, 2, false, [0, 0], 0)
    expect(dashes(b)).toEqual([[0, 0, 100, 0]])
    b.clear()
    b.cut(line, 0, 2, false, [-1, 5], 0)
    expect(dashes(b)).toEqual([[0, 0, 100, 0]])
  })
})

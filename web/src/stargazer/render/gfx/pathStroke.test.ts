import { describe, expect, it } from 'vitest'
import { GfxPath } from './GfxPath'
import { appendStrokeFill } from './pathStroke'

/** Signed area of every contour of a path, from its flattened points. */
function areas(p: GfxPath): number[] {
  const f = p.flatten(0.1)
  const out: number[] = []
  for (let c = 0; c < f.contourCount; c++) {
    const a = f.starts[c]
    const n = f.starts[c + 1] - a
    let s = 0
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n
      s +=
        f.points[(a + i) * 2] * f.points[(a + j) * 2 + 1] -
        f.points[(a + j) * 2] * f.points[(a + i) * 2 + 1]
    }
    out.push(s / 2)
  }
  return out
}

const stroke = (
  pts: number[],
  closed: boolean,
  cap: 'butt' | 'round' | 'square',
  join: 'miter' | 'round' | 'bevel',
) => {
  const out = new GfxPath()
  appendStrokeFill(out, pts, 0, pts.length / 2, closed, 10, cap, join, 4, 0.05)
  return out
}

describe('appendStrokeFill', () => {
  it('draws a butt-capped line as one quad of length × width', () => {
    const a = areas(stroke([0, 0, 100, 0], false, 'butt', 'miter'))
    expect(a).toHaveLength(1)
    expect(a[0]).toBeCloseTo(1000, 6)
  })

  it('winds every piece the same way so the union is nonzero-safe', () => {
    const a = areas(
      stroke(
        [0, 0, 50, 0, 50, 50, 0, 50, 0, 0, 20, 20],
        false,
        'round',
        'round',
      ),
    )
    expect(a.length).toBeGreaterThan(5)
    for (const v of a) expect(v).toBeGreaterThan(0)
  })

  it('extends a square cap by half the width and adds a miter piece at a bend', () => {
    const square = areas(stroke([0, 0, 100, 0], false, 'square', 'miter'))
    expect(square[0] + square[1] + square[2]).toBeCloseTo(1000 + 2 * 50, 6)
    const bend = areas(stroke([0, 0, 50, 0, 50, 50], false, 'butt', 'miter'))
    // Two quads and one miter wedge of 5×5 + 5×5 triangles.
    expect(bend).toHaveLength(3)
    expect(bend[2]).toBeCloseTo(25, 6)
    // A bevel is the single triangle of half that.
    const bevel = areas(stroke([0, 0, 50, 0, 50, 50], false, 'butt', 'bevel'))
    expect(bevel[2]).toBeCloseTo(12.5, 6)
  })

  it('falls back to a bevel past the miter limit and closes a ring without caps', () => {
    const out = new GfxPath()
    // A spike of about 5 degrees: the miter ratio is far over 4.
    appendStrokeFill(
      out,
      [0, 0, 100, 0, 0, 8],
      0,
      3,
      false,
      10,
      'butt',
      'miter',
      4,
      0.05,
    )
    const a = areas(out)
    expect(a).toHaveLength(3)
    expect(a[2]).toBeLessThan(30)
    const ring = areas(
      stroke([0, 0, 20, 0, 20, 20, 0, 20], true, 'round', 'miter'),
    )
    // Four segments and four miters, no caps.
    expect(ring).toHaveLength(8)
  })

  it('ignores repeated points and draws a lone point as a dot', () => {
    const a = areas(
      stroke([0, 0, 0, 0, 100, 0, 100, 0], false, 'butt', 'miter'),
    )
    expect(a).toHaveLength(1)
    const dot = areas(stroke([5, 5], false, 'round', 'round'))
    expect(dot[0]).toBeGreaterThan(70)
    expect(dot[0]).toBeLessThan(79)
  })
})

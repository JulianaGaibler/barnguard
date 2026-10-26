import { describe, expect, it } from 'vitest'
import { stripCellAt, stripLayout, type Box } from './geometry'

const BOUNDS = { left: 0, width: 552 }
const KEY_W = 48
const GAP = 8
const key = (left: number): Box => ({
  left,
  top: 200,
  width: KEY_W,
  height: 64,
})

describe('stripLayout', () => {
  it('grows right from a key in the left half, plain letter on the key', () => {
    const layout = stripLayout(key(56), BOUNDS, 4, GAP)
    expect(layout.cellLefts[0]).toBe(56)
    expect(layout.cellLefts[1]).toBe(56 + KEY_W + GAP)
  })

  it('grows left from a key in the right half, plain letter on the key', () => {
    const layout = stripLayout(key(448), BOUNDS, 4, GAP)
    expect(layout.cellLefts[0]).toBe(448)
    expect(layout.cellLefts[1]).toBe(448 - KEY_W - GAP)
  })

  it('stays inside the keyboard at either edge', () => {
    for (const left of [0, 56, 224, 448, 504]) {
      for (const count of [2, 6, 10]) {
        const layout = stripLayout(key(left), BOUNDS, count, GAP)
        expect(layout.left).toBeGreaterThanOrEqual(0)
        expect(layout.left + layout.width).toBeLessThanOrEqual(BOUNDS.width)
        for (const cellLeft of layout.cellLefts) {
          expect(cellLeft).toBeGreaterThanOrEqual(layout.left)
          expect(cellLeft + KEY_W).toBeLessThanOrEqual(
            layout.left + layout.width,
          )
        }
      }
    }
  })

  it('stays inside bounds that start away from the left edge', () => {
    const inner = { left: 24, width: 552 }
    const layout = stripLayout(key(24), inner, 10, GAP)
    expect(layout.left).toBe(24)
    const right = stripLayout(key(528), inner, 10, GAP)
    expect(right.left + right.width).toBe(576)
  })

  it('sits one gap above the key', () => {
    const layout = stripLayout(key(56), BOUNDS, 3, GAP)
    expect(layout.top + layout.height + GAP).toBe(200)
  })

  it('fits the longest strip in one row', () => {
    // 10 cells is the most any letter has, plain letter included.
    const layout = stripLayout(key(0), BOUNDS, 10, GAP)
    expect(layout.width).toBeLessThanOrEqual(BOUNDS.width)
  })
})

describe('stripCellAt', () => {
  const layout = stripLayout(key(56), BOUNDS, 4, GAP)
  const mid = (i: number) => layout.cellLefts[i] + KEY_W / 2

  it('picks the cell under the finger', () => {
    for (let i = 0; i < 4; i++) {
      expect(stripCellAt(layout, mid(i), layout.top + 10)).toBe(i)
    }
  })

  it('keeps picking while the finger is back over the key row', () => {
    expect(stripCellAt(layout, mid(2), 230)).toBe(2)
  })

  it('picks nothing below the held key', () => {
    expect(stripCellAt(layout, mid(1), 270)).toBeNull()
  })

  it('picks nothing far above the strip', () => {
    expect(stripCellAt(layout, mid(1), layout.top - 70)).toBeNull()
  })

  it('picks nothing well past either end', () => {
    expect(stripCellAt(layout, layout.left - 40, layout.top + 10)).toBeNull()
    expect(
      stripCellAt(layout, layout.left + layout.width + 40, layout.top + 10),
    ).toBeNull()
  })

  it('picks the end cell just past an end', () => {
    expect(stripCellAt(layout, layout.left - 10, layout.top + 10)).toBe(0)
  })
})

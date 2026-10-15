import { describe, expect, it } from 'vitest'
import type { CompareFn, StencilOp } from './GfxDevice'
import {
  STENCIL_ROWS,
  stencilReferenceFor,
  type StencilRow,
} from './stencilRecipe'

// A one-pixel stencil buffer that applies the recipe rows exactly as a GPU
// would, so the table is checked by what it does and not by its constants.

function compare(fn: CompareFn, ref: number, value: number): boolean {
  switch (fn) {
    case 'equal':
      return ref === value
    case 'not-equal':
      return ref !== value
    case 'less':
      return ref < value
    case 'always':
      return true
    default:
      throw new Error(`unused compare ${fn}`)
  }
}

function op(o: StencilOp, value: number, ref: number): number {
  switch (o) {
    case 'keep':
      return value
    case 'zero':
      return 0
    case 'replace':
      return ref
    case 'invert':
      return ~value & 0xff
    case 'increment-wrap':
      return (value + 1) & 0xff
    case 'decrement-wrap':
      return (value - 1) & 0xff
    default:
      throw new Error(`unused op ${o}`)
  }
}

/** One fragment of `row` at clip depth `depth`. `back` selects the back face. */
function frag(
  value: number,
  row: StencilRow,
  depth: number,
  back = false,
): number {
  const { state } = STENCIL_ROWS[row]
  const face = back ? (state.back ?? state.front) : state.front
  const ref = stencilReferenceFor(row, depth)
  const read = state.readMask ?? 0xff
  const write = state.writeMask ?? 0xff
  const pass = compare(face.compare ?? 'always', ref & read, value & read)
  const next = op(
    pass ? (face.passOp ?? 'keep') : (face.failOp ?? 'keep'),
    value,
    ref,
  )
  return (value & ~write) | (next & write)
}

describe('stencil recipe', () => {
  it('counts winding mod 16 under fans and clears it in the cover', () => {
    for (const depth of [0, 3]) {
      let v = depth << 5
      // Five same-direction fans, then one the other way.
      for (let i = 0; i < 5; i++) v = frag(v, 'fanNonzero', depth)
      v = frag(v, 'fanNonzero', depth, true)
      expect(v & 0x0f).toBe(4)
      expect(v >> 5).toBe(depth)
      // The cover paints (stencil passes not-equal) and zeroes the count.
      const cover = STENCIL_ROWS.coverNonzero.state
      expect(compare(cover.front.compare!, 0, v & cover.readMask!)).toBe(true)
      v = frag(v, 'coverNonzero', depth)
      expect(v).toBe(depth << 5)
    }
  })

  it('wraps the count inside the winding bits without touching flag or depth', () => {
    let v = (2 << 5) | 0x10
    for (let i = 0; i < 16; i++) v = frag(v, 'fanNonzero', 2)
    // The fan compares depth bits only, so a set flag does not block it. 16 fans
    // wrap the nibble without carrying into the flag.
    expect(v).toBe((2 << 5) | 0x10)
    v = frag(v, 'fanNonzero', 2, true)
    expect(v & 0x0f).toBe(0x0f)
    expect(v & 0xf0).toBe(0x50)
  })

  it('leaves pixels outside the current clip alone', () => {
    const outside = 1 << 5
    expect(frag(outside, 'fanNonzero', 2)).toBe(outside)
    expect(frag(outside, 'fanEvenOdd', 2)).toBe(outside)
  })

  it('toggles even-odd coverage and covers only odd counts', () => {
    let v = 0
    v = frag(v, 'fanEvenOdd', 0)
    expect(v & 1).toBe(1)
    v = frag(v, 'fanEvenOdd', 0)
    expect(v & 1).toBe(0)
    const cover = STENCIL_ROWS.coverEvenOdd.state
    expect(compare(cover.front.compare!, 0, v & cover.readMask!)).toBe(false)
    v = frag(v, 'fanEvenOdd', 0)
    expect(compare(cover.front.compare!, 0, v & cover.readMask!)).toBe(true)
    expect(frag(v, 'coverEvenOdd', 0)).toBe(0)
  })

  it('pushes a clip one level deeper where the fan counted, then pops it', () => {
    // Inside the shape: depth 1, fan counts winding 1.
    let inside = 1 << 5
    inside = frag(inside, 'fanNonzero', 1)
    inside = frag(inside, 'clipApplyNonzero', 1)
    expect(inside).toBe(2 << 5)
    // Outside the shape: the fan left no winding, so apply leaves depth alone.
    const outside = frag(1 << 5, 'clipApplyNonzero', 1)
    expect(outside).toBe(1 << 5)
    // Pop from depth 2 back to 1 lowers only the pixels that went deeper.
    expect(frag(inside, 'clipPop', 2)).toBe(1 << 5)
    expect(frag(outside, 'clipPop', 2)).toBe(1 << 5)
    // Pixels already shallower than the popped depth stay.
    expect(frag(0, 'clipPop', 2)).toBe(0)
  })

  it('marks a pixel once and clears only marked pixels', () => {
    for (const depth of [0, 4]) {
      const base = depth << 5
      let v = frag(base, 'strokeMark', depth)
      expect(v).toBe(base | 0x10)
      // A second fragment fails the test and changes nothing.
      expect(frag(v, 'strokeMark', depth)).toBe(v)
      v = frag(v, 'strokeReset', depth)
      expect(v).toBe(base)
      // Resetting twice must not set the flag again.
      expect(frag(v, 'strokeReset', depth)).toBe(base)
    }
  })

  it('keeps every row away from winding bits it does not own', () => {
    for (const row of ['strokeMark', 'strokeReset'] as const) {
      const wm = STENCIL_ROWS[row].state.writeMask!
      expect(wm & 0xef).toBe(0)
    }
    expect(STENCIL_ROWS.clipPop.state.writeMask).toBe(0xe0)
  })
})

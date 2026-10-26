import { describe, expect, it } from 'vitest'
import { MIN_ROW_GAP, ROW_GAP, TILE_SIZE, rowTops } from './rowLayout'

const box = { x: 1024, y: 159, width: 768, height: 760 }

describe('rowTops', () => {
  it('centers the stack in the box', () => {
    const tops = rowTops([144, 144, 144], box)
    const bottom = tops[2] + 144
    expect(tops[0] - box.y).toBeCloseTo(box.y + box.height - bottom)
  })

  it('leaves a gap between answers', () => {
    const tops = rowTops([144, 192, 144], box)
    expect(tops[1] - tops[0]).toBe(144 + ROW_GAP)
    expect(tops[2] - tops[1]).toBe(192 + ROW_GAP)
  })

  it('never makes an answer shorter than its square', () => {
    const tops = rowTops([40, 40], box)
    expect(tops[1] - tops[0]).toBe(TILE_SIZE + ROW_GAP)
  })

  it('reproduces the design for three two-line answers', () => {
    const tops = rowTops([144, 144, 144], box)
    const stack = 3 * 144 + 2 * ROW_GAP
    expect(tops[0]).toBeCloseTo(159 + (760 - stack) / 2)
  })

  it('centers a single answer', () => {
    expect(rowTops([128], box)[0]).toBe(159 + (760 - 128) / 2)
  })

  it('gives no rows for no answers', () => {
    expect(rowTops([], box)).toEqual([])
  })
})

describe('rowTops in a box that is too short', () => {
  const short = { x: 0, y: 0, width: 832, height: 640 }

  it('closes the gaps so the stack fits', () => {
    const tight = { ...short, height: 580 }
    const tops = rowTops([128, 128, 128, 128], tight)
    expect(tops[0]).toBeCloseTo(0)
    expect(tops[3]! + 128).toBeCloseTo(580)
    expect(tops[1]! - tops[0]! - 128).toBeCloseTo((580 - 512) / 3)
  })

  it('keeps a minimum gap when even that does not fit', () => {
    const tops = rowTops([128, 128, 128, 128], { ...short, height: 400 })
    expect(tops[1]! - tops[0]! - 128).toBe(MIN_ROW_GAP)
  })

  it('fits four answers in the portrait box of the smallest phone', () => {
    const need = 4 * TILE_SIZE + 3 * ROW_GAP
    expect(need).toBe(308)
  })
})

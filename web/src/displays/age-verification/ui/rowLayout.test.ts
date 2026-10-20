import { describe, expect, it } from 'vitest'
import { ROW_GAP, TILE_SIZE, rowTops } from './rowLayout'

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
    // Three rows of 144 with 63 between: 3 * 144 + 2 * 63 = 558, in a 760 box.
    const tops = rowTops([144, 144, 144], box)
    expect(tops[0]).toBeCloseTo(159 + (760 - 558) / 2)
  })

  it('centers a single answer', () => {
    expect(rowTops([128], box)[0]).toBe(159 + (760 - 128) / 2)
  })

  it('gives no rows for no answers', () => {
    expect(rowTops([], box)).toEqual([])
  })
})

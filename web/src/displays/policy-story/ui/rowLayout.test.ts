import { describe, expect, it } from 'vitest'
import {
  ANSWER_COLUMN_GAP,
  MIN_ROW_GAP,
  ROW_GAP,
  TILE_SIZE,
  columnLayout,
  centerEach,
  centerRow,
  columnTops,
  rowTops,
} from './rowLayout'

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

  it('stacks three two-line answers as one block', () => {
    const stack = 3 * 144 + 2 * ROW_GAP
    const tops = rowTops([144, 144, 144], box)
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
  const short = { x: 0, y: 0, width: 832, height: 580 }

  it('closes the gaps so the stack fits', () => {
    const tops = rowTops([128, 128, 128, 128], short)
    expect(tops[0]).toBeCloseTo(0)
    expect(tops[3]! + 128).toBeCloseTo(580)
    expect(tops[1]! - tops[0]! - 128).toBeCloseTo((580 - 512) / 3)
  })

  it('keeps a minimum gap when even that does not fit', () => {
    const tops = rowTops([128, 128, 128, 128], { ...short, height: 400 })
    expect(tops[1]! - tops[0]! - 128).toBe(MIN_ROW_GAP)
  })
})

describe('columnLayout', () => {
  const wide = { x: 128, y: 600, width: 1664, height: 300 }

  it('gives every answer the same width with a gap between them', () => {
    const { xs, width } = columnLayout(3, wide)
    expect(width).toBeCloseTo((1664 - 2 * ANSWER_COLUMN_GAP) / 3)
    expect(xs[0]).toBe(128)
    expect(xs[1]! - xs[0]!).toBeCloseTo(width + ANSWER_COLUMN_GAP)
    expect(xs[2]! + width).toBeCloseTo(128 + 1664)
  })

  it('fills the box with one answer', () => {
    expect(columnLayout(1, wide)).toEqual({ xs: [128], width: 1664 })
  })
})

describe('columnTops', () => {
  const box = { x: 0, y: 600, width: 1664, height: 300 }

  it('puts the answers on one top that centers the tallest', () => {
    const tops = columnTops([140, 200, 120], box)
    expect(new Set(tops).size).toBe(1)
    expect(tops[0]).toBe(600 + (300 - 200) / 2)
  })

  it('never makes a column shorter than the square', () => {
    expect(columnTops([10, 20], box)[0]).toBe(600 + (300 - TILE_SIZE) / 2)
  })
})

describe('centerRow', () => {
  const wide = { x: 128, y: 600, width: 1664, height: 300 }

  it('keeps a fixed gap and centers the row', () => {
    const xs = centerRow([400, 600], wide)
    expect(xs[1]! - xs[0]! - 400).toBe(ANSWER_COLUMN_GAP)
    const left = xs[0]! - 128
    const right = 128 + 1664 - (xs[1]! + 600)
    expect(left).toBeCloseTo(right)
  })
})

describe('centerEach', () => {
  it('centers every answer on its own', () => {
    const xs = centerEach([200, 400], { x: 100, y: 0, width: 800, height: 10 })
    expect(xs).toEqual([400, 300])
  })
})

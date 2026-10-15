import { describe, expect, it } from 'vitest'
import {
  DATA_TABLE_WIDTH as W,
  dataTableRows,
  dataTableSpans,
} from './dataTable'

describe('dataTableSpans', () => {
  it('writes a range inside one row as one span', () => {
    expect(dataTableSpans(5, 10)).toEqual([
      { x: 5, y: 0, width: 10, height: 1, first: 0 },
    ])
  })

  it('splits a range into a head row, whole rows and a tail row', () => {
    const spans = dataTableSpans(W - 2, 2 + 2 * W + 3)
    expect(spans).toEqual([
      { x: W - 2, y: 0, width: 2, height: 1, first: 0 },
      { x: 0, y: 1, width: W, height: 2, first: 2 },
      { x: 0, y: 3, width: 3, height: 1, first: 2 + 2 * W },
    ])
    expect(spans.reduce((n, s) => n + s.width * s.height, 0)).toBe(
      2 + 2 * W + 3,
    )
  })

  it('rounds capacity up to whole rows', () => {
    expect(dataTableRows(0)).toBe(1)
    expect(dataTableRows(W)).toBe(1)
    expect(dataTableRows(W + 1)).toBe(2)
  })
})

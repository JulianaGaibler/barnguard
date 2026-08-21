// The collapse-to-zero failure mode is silent: `Flex` offers a zero cross-axis
// minimum unless told to stretch, a `LayoutBuilder` measures to that minimum,
// and nothing warns because the maximum is finite. So these assert on actual
// sizes rather than just that the tree runs.

import { describe, expect, it } from 'vitest'
import { cellRect, computeTable, orgGeom, shortlistSlots } from './layout'
import { LAYOUT } from './tuning'

const ASPECTS: [string, number, number][] = [
  ['16:9', 1920, 1080],
  ['21:9 ultrawide', 2560, 1080],
  ['4:3', 1440, 1080],
  ['tall', 1080, 1600],
]

describe('table layout', () => {
  it.each(ASPECTS)('gives every region real size at %s', (_name, w, h) => {
    const view = { x: 0, y: 0, width: w, height: h }
    const t = computeTable(view)
    for (const rect of [...t.org, ...t.resources, ...t.shortlist, t.marker]) {
      expect(rect.width).toBeGreaterThan(0)
      expect(rect.height).toBeGreaterThan(0)
    }
  })

  it.each(ASPECTS)('keeps every region inside the view at %s', (_n, w, h) => {
    const view = { x: 100, y: 50, width: w, height: h }
    const t = computeTable(view)
    for (const r of [...t.org, ...t.resources, ...t.shortlist, t.marker]) {
      expect(r.x).toBeGreaterThanOrEqual(view.x - 0.5)
      expect(r.y).toBeGreaterThanOrEqual(view.y - 0.5)
      expect(r.x + r.width).toBeLessThanOrEqual(view.x + view.width + 0.5)
      expect(r.y + r.height).toBeLessThanOrEqual(view.y + view.height + 0.5)
    }
  })

  it('puts the two orgs on either side of the shortlists', () => {
    const t = computeTable({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(t.org[0].x + t.org[0].width).toBeLessThanOrEqual(
      t.shortlist[0].x + 1,
    )
    expect(t.shortlist[0].x + t.shortlist[0].width).toBeLessThanOrEqual(
      t.org[1].x + 1,
    )
  })

  it('stacks Management above the marker above IC', () => {
    const t = computeTable({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(t.shortlist[0].y).toBeLessThan(t.marker.y)
    expect(t.marker.y).toBeLessThan(t.shortlist[1].y)
  })

  // Nothing draggable may begin inside the launcher pull-down zone.
  it('leaves the top of the centre column clear', () => {
    const view = { x: 0, y: 0, width: 1920, height: 1080 }
    const t = computeTable(view)
    expect(t.shortlist[0].y - view.y).toBeGreaterThanOrEqual(
      LAYOUT.headerHeight,
    )
  })

  it('puts the resource bar under its own org', () => {
    const t = computeTable({ x: 0, y: 0, width: 1920, height: 1080 })
    for (const i of [0, 1]) {
      expect(t.resources[i]!.y).toBeGreaterThan(t.org[i]!.y)
    }
  })
})

describe('org geometry', () => {
  it.each(ASPECTS)('fits nine portrait cards at %s', (_n, w, h) => {
    const t = computeTable({ x: 0, y: 0, width: w, height: h })
    const g = orgGeom(t.org[0])
    expect(g.cell).toBeGreaterThan(0)
    const first = cellRect(g, 0, 0)
    const last = cellRect(g, 2, 2)
    // Portrait cards, and the 3x3 stays inside its region.
    expect(first.height / first.width).toBeCloseTo(LAYOUT.cardAspect, 5)
    expect(last.x + last.width).toBeLessThanOrEqual(
      t.org[0].x + t.org[0].width + 0.5,
    )
    expect(last.y + last.height).toBeLessThanOrEqual(
      t.org[0].y + t.org[0].height + 0.5,
    )
  })

  it('spaces cells evenly', () => {
    const t = computeTable({ x: 0, y: 0, width: 1920, height: 1080 })
    const g = orgGeom(t.org[0])
    const a = cellRect(g, 0, 0)
    const b = cellRect(g, 0, 1)
    const c = cellRect(g, 0, 2)
    expect(b.x - a.x).toBeCloseTo(c.x - b.x, 5)
  })
})

describe('shortlist slots', () => {
  it.each(ASPECTS)('lays out three cards in a row at %s', (_n, w, h) => {
    const t = computeTable({ x: 0, y: 0, width: w, height: h })
    const slots = shortlistSlots(t.shortlist[0])
    expect(slots).toHaveLength(3)
    for (const s of slots) {
      expect(s.width).toBeGreaterThan(0)
      expect(s.height).toBeGreaterThan(0)
    }
    expect(slots[0]!.y).toBeCloseTo(slots[2]!.y, 5)
    expect(slots[0]!.x).toBeLessThan(slots[1]!.x)
    expect(slots[1]!.x).toBeLessThan(slots[2]!.x)
    expect(slots[2]!.x + slots[2]!.width).toBeLessThanOrEqual(
      t.shortlist[0].x + t.shortlist[0].width + 0.5,
    )
  })
})

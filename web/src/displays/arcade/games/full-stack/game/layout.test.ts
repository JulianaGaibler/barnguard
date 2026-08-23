// The row is nine equal cards in three groups of three, evenly spaced. These
// pin that: an org cell and a shortlist card come out the same width, the gap
// between regions is wider than the gap between cards, and the four horizontal
// gaps, two margins and two between regions, are equal.

import { describe, expect, it } from 'vitest'
import {
  cellRect,
  computeTable,
  helpFocus,
  orgGeom,
  shortlistSlots,
} from './layout'
import { LAYOUT } from './tuning'

const ASPECTS: [string, number, number][] = [
  ['16:9', 1920, 1080],
  ['21:9 ultrawide', 2560, 1080],
  ['4:3', 1440, 1080],
  ['tall', 1080, 1600],
]

const allRects = (t: ReturnType<typeof computeTable>) => [
  ...t.org,
  ...t.resources,
  ...t.shortlist,
  ...t.captions,
  t.controls,
]

describe('table layout', () => {
  it.each(ASPECTS)('gives every region real size at %s', (_name, w, h) => {
    const t = computeTable({ x: 0, y: 0, width: w, height: h })
    for (const r of allRects(t)) {
      expect(r.width).toBeGreaterThan(0)
      expect(r.height).toBeGreaterThan(0)
    }
  })

  it.each(ASPECTS)('keeps every region inside the view at %s', (_n, w, h) => {
    const view = { x: 100, y: 50, width: w, height: h }
    const t = computeTable(view)
    for (const r of allRects(t)) {
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

  it('stacks Management above IC above the controls', () => {
    const t = computeTable({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(t.shortlist[0].y).toBeLessThan(t.shortlist[1].y)
    expect(t.shortlist[1].y).toBeLessThan(t.controls.y)
  })

  // Nothing draggable may begin inside the launcher pull-down zone at the top.
  it('reserves a clear band at the top', () => {
    const view = { x: 0, y: 0, width: 1920, height: 1080 }
    const t = computeTable(view)
    const reserve = view.height * LAYOUT.topReserveFrac
    for (const r of allRects(t)) {
      expect(r.y - view.y).toBeGreaterThanOrEqual(reserve - 0.5)
    }
  })

  it('puts the resource bar under its own org', () => {
    const t = computeTable({ x: 0, y: 0, width: 1920, height: 1080 })
    for (const i of [0, 1]) {
      expect(t.resources[i]!.y).toBeGreaterThan(t.org[i]!.y)
      expect(t.resources[i]!.x).toBe(t.org[i]!.x)
    }
  })

  it('makes nine equal cards across the row', () => {
    const t = computeTable({ x: 0, y: 0, width: 1920, height: 1080 })
    const cellLeft = orgGeom(t.org[0]).cell
    const cellRight = orgGeom(t.org[1]).cell
    const cardMid = shortlistSlots(t.shortlist[0])[0]!.width
    expect(cellRight).toBeCloseTo(cellLeft, 3)
    expect(cardMid).toBeCloseTo(cellLeft, 3)
  })

  it.each(ASPECTS)('gaps the groups wider than the cards at %s', (_n, w, h) => {
    const t = computeTable({ x: 0, y: 0, width: w, height: h })
    const cardGap = orgGeom(t.org[0]).gap
    const regionGap = t.shortlist[0].x - (t.org[0].x + t.org[0].width)
    expect(regionGap).toBeGreaterThan(cardGap)
  })
})

describe('org geometry', () => {
  it.each(ASPECTS)('fits nine portrait cards at %s', (_n, w, h) => {
    const t = computeTable({ x: 0, y: 0, width: w, height: h })
    const g = orgGeom(t.org[0])
    expect(g.cell).toBeGreaterThan(0)
    const first = cellRect(g, 0, 0)
    const last = cellRect(g, 2, 2)
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

describe('even horizontal rhythm', () => {
  it('gives the same gap at each edge and between each pair of regions', () => {
    const view = { x: 40, y: 10, width: 1920, height: 1080 }
    const t = computeTable(view)
    const columns = [t.org[0], t.shortlist[0], t.org[1]]
    const gaps = [
      columns[0]!.x - view.x,
      columns[1]!.x - (columns[0]!.x + columns[0]!.width),
      columns[2]!.x - (columns[1]!.x + columns[1]!.width),
      view.x + view.width - (columns[2]!.x + columns[2]!.width),
    ]
    for (const gap of gaps) expect(gap).toBeCloseTo(gaps[0]!, 6)
    expect(gaps[0]!).toBeGreaterThan(0)
  })
})

describe('the help view', () => {
  const view = { x: 40, y: 10, width: 1920, height: 1080 }

  it('puts the card on the left and the sheet beside it', () => {
    const { card, sheet } = helpFocus(view)
    expect(card.width).toBeGreaterThan(0)
    expect(sheet.width).toBeGreaterThan(0)
    // `card` is world, `sheet` is local to the view, so the comparison has to
    // put them in the same space before it means anything.
    expect(sheet.x).toBeGreaterThan(card.x - view.x + card.width)
    // Prose needs the room, so the sheet is the wider of the two.
    expect(sheet.width).toBeGreaterThan(card.width)
  })

  it('keeps both inside the view', () => {
    const { card, sheet } = helpFocus(view)
    expect(card.x).toBeGreaterThanOrEqual(view.x)
    expect(card.y).toBeGreaterThanOrEqual(view.y)
    expect(card.y + card.height).toBeLessThanOrEqual(view.y + view.height)
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(view.width)
  })

  it('draws the card at the deck aspect', () => {
    const { card } = helpFocus(view)
    expect(card.height / card.width).toBeCloseTo(388 / 256, 3)
  })

  it('centres the pair vertically', () => {
    const { card } = helpFocus(view)
    const above = card.y - view.y
    const below = view.y + view.height - (card.y + card.height)
    expect(above).toBeCloseTo(below, 6)
  })
})

describe('the elevator shaft', () => {
  const view = { x: 40, y: 10, width: 1920, height: 1080 }

  it('spans both shortlists', () => {
    const t = computeTable(view)
    expect(t.elevator.y).toBeCloseTo(t.shortlist[0].y, 6)
    expect(t.elevator.y + t.elevator.height).toBeCloseTo(
      t.shortlist[1].y + t.shortlist[1].height,
      6,
    )
  })

  // It lives in the gap between the org and the centre column, so the nine
  // cards keep the width they share.
  it('sits clear of the left org and the shortlists', () => {
    const t = computeTable(view)
    expect(t.elevator.x).toBeGreaterThan(t.org[0].x + t.org[0].width)
    expect(t.elevator.x + t.elevator.width).toBeLessThanOrEqual(
      t.shortlist[0].x,
    )
    expect(t.elevator.width).toBeGreaterThan(0)
  })
})

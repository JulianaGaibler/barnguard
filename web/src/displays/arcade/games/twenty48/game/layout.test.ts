import { describe, expect, it } from 'vitest'
import {
  cellCenter,
  cellRect,
  computeBoardGeom,
  computeDualSlots,
  computeSoloSlot,
  containsWorld,
} from './layout'
import { tileDepth } from './tuning'
import { type Bounds, CELLS, type Direction, SIZE } from './types'

const REGION: Bounds = { x: 0, y: 0, width: 1920, height: 1080 }
const ASPECTS: Array<[string, Bounds]> = [
  ['16:9', REGION],
  ['4:3', { x: -100, y: 0, width: 1440, height: 1080 }],
  ['21:9', { x: -420, y: 0, width: 2520, height: 1080 }],
  ['portrait', { x: 0, y: -200, width: 1080, height: 1480 }],
]

/** Whether two rects share any area. */
function overlaps(a: Bounds, b: Bounds): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

function contains(outer: Bounds, inner: Bounds): boolean {
  return (
    inner.x >= outer.x - 0.001 &&
    inner.y >= outer.y - 0.001 &&
    inner.x + inner.width <= outer.x + outer.width + 0.001 &&
    inner.y + inner.height <= outer.y + outer.height + 0.001
  )
}

const DIRECTIONS: Direction[] = ['up', 'down', 'left', 'right']

describe('computeSoloSlot', () => {
  it('is square and inside the region at every aspect', () => {
    for (const [name, rect] of ASPECTS) {
      const slot = computeSoloSlot(rect)
      expect(slot.width, name).toBeCloseTo(slot.height, 3)
      expect(slot.width, name).toBeGreaterThan(0)
      expect(contains(rect, slot), name).toBe(true)
    }
  })

  it('leaves a band above the board for the score', () => {
    const slot = computeSoloSlot(REGION)
    expect(slot.y).toBeGreaterThan(REGION.y + REGION.height * 0.1)
  })
})

describe('computeDualSlots', () => {
  it('gives two equal squares that never overlap', () => {
    for (const [name, rect] of ASPECTS) {
      const { a, b } = computeDualSlots(rect)
      expect(a.width, name).toBeCloseTo(a.height, 3)
      expect(a.width, name).toBeCloseTo(b.width, 3)
      expect(overlaps(a, b), name).toBe(false)
      expect(contains(rect, a), name).toBe(true)
      expect(contains(rect, b), name).toBe(true)
    }
  })

  it('sits side by side in landscape and stacks in portrait', () => {
    const wide = computeDualSlots(REGION)
    expect(wide.orientation).toBe('row')
    expect(wide.a.x).toBeLessThan(wide.b.x)

    const tall = computeDualSlots({ x: 0, y: 0, width: 1080, height: 1480 })
    expect(tall.orientation).toBe('column')
    expect(tall.a.y).toBeLessThan(tall.b.y)
  })

  it('keeps each board bar clear of the other board', () => {
    const { a, b } = computeDualSlots(REGION)
    const ga = computeBoardGeom(a)
    const gb = computeBoardGeom(b)
    for (const d of DIRECTIONS) {
      for (const e of DIRECTIONS) {
        expect(overlaps(ga.arrows[d], gb.arrows[e])).toBe(false)
      }
    }
  })
})

describe('computeBoardGeom', () => {
  const geom = computeBoardGeom(computeSoloSlot(REGION))

  it('fits four cells, three gaps and two pads across the plate', () => {
    const span = SIZE * geom.cell + (SIZE - 1) * geom.gap + 2 * geom.pad
    expect(span).toBeCloseTo(geom.plate.width, 3)
  })

  it('pads the plate by one gap', () => {
    expect(geom.pad).toBeCloseTo(geom.gap, 6)
  })

  it('leaves the board comfortably smaller than the region', () => {
    // A board that fills a booth-sized screen costs the player their overview.
    expect(geom.slot.height).toBeLessThan(REGION.height * 0.7)
  })

  it('keeps the plate inside the slot', () => {
    expect(contains(geom.slot, geom.plate)).toBe(true)
  })

  it('spans each bar along its whole plate edge', () => {
    expect(geom.arrows.up.width).toBeCloseTo(geom.plate.width, 3)
    expect(geom.arrows.down.width).toBeCloseTo(geom.plate.width, 3)
    expect(geom.arrows.left.height).toBeCloseTo(geom.plate.height, 3)
    expect(geom.arrows.right.height).toBeCloseTo(geom.plate.height, 3)
  })

  it('keeps the bars inside the slot and off the plate', () => {
    for (const d of DIRECTIONS) {
      expect(contains(geom.slot, geom.arrows[d]), d).toBe(true)
      expect(overlaps(geom.plate, geom.arrows[d]), d).toBe(false)
    }
  })

  it('never overlaps one bar with another, including at the corners', () => {
    for (let i = 0; i < DIRECTIONS.length; i++) {
      for (let j = i + 1; j < DIRECTIONS.length; j++) {
        const a = geom.arrows[DIRECTIONS[i]]
        const b = geom.arrows[DIRECTIONS[j]]
        expect(overlaps(a, b), `${DIRECTIONS[i]} vs ${DIRECTIONS[j]}`).toBe(
          false,
        )
      }
    }
  })

  it('gives a bar that clears the minimum touch target', () => {
    // 48 CSS px at the 1920-wide design width, so in world units 48 exactly.
    expect(geom.bar).toBeGreaterThanOrEqual(48)
  })
})

describe('cell mapping', () => {
  const geom = computeBoardGeom(computeSoloSlot(REGION))

  it('centers every cell inside its own rect', () => {
    for (let i = 0; i < CELLS; i++) {
      const r = cellRect(geom, i)
      const c = cellCenter(geom, i)
      expect(c.x).toBeCloseTo(r.x + r.width / 2, 6)
      expect(c.y).toBeCloseTo(r.y + r.height / 2, 6)
    }
  })

  it('lays cells out left to right, top to bottom', () => {
    expect(cellRect(geom, 1).x).toBeGreaterThan(cellRect(geom, 0).x)
    expect(cellRect(geom, SIZE).y).toBeGreaterThan(cellRect(geom, 0).y)
    expect(cellRect(geom, SIZE).x).toBeCloseTo(cellRect(geom, 0).x, 6)
  })

  it('keeps every cell on the plate', () => {
    for (let i = 0; i < CELLS; i++) {
      const r = cellRect(geom, i)
      expect(contains(geom.plate, r), `cell ${i}`).toBe(true)
    }
  })

  it('gives a square cell that a whole tile, extrusion included, fits', () => {
    // The extrusion comes out of the tile's own square rather than hanging off
    // the bottom, so a tile never reaches into the row below it.
    const r = cellRect(geom, 0)
    expect(r.width).toBeCloseTo(r.height, 6)
    expect(tileDepth(geom.cell, 2048)).toBeLessThan(geom.cell)
  })

  it('rejects points off the plate', () => {
    expect(containsWorld(geom, geom.plate.x - 10, geom.plate.y + 10)).toBe(
      false,
    )
    expect(containsWorld(geom, geom.plate.x + 10, geom.plate.y - 10)).toBe(
      false,
    )
  })
})

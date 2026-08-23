import { describe, expect, it } from 'vitest'
import {
  cellAtWorld,
  cellCenter,
  cellOrigin,
  computeFieldGeom,
  computeRaceSlots,
  computeSoloSlot,
  colorAtWorld,
  computeTerritorySlots,
  sideMargins,
  swatchRect,
  wellRect,
  type Slot,
} from './layout'
import { GEOM } from './tuning'
import type { Bounds } from './types'

/** The arcade region at 16:9, plus the aspects a resized window produces. */
const REGIONS: Record<string, Bounds> = {
  landscape: { x: 0, y: 0, width: 1920, height: 1080 },
  wide: { x: 0, y: 0, width: 2400, height: 1000 },
  square: { x: 0, y: 0, width: 1200, height: 1200 },
  portrait: { x: 0, y: 0, width: 900, height: 1600 },
  offset: { x: -320, y: 140, width: 1920, height: 1080 },
}

function contains(outer: Bounds, inner: Bounds): boolean {
  const slack = 1e-6
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  )
}

function overlaps(a: Bounds, b: Bounds): boolean {
  const slack = 1e-6
  return (
    a.x + a.width > b.x + slack &&
    b.x + b.width > a.x + slack &&
    a.y + a.height > b.y + slack &&
    b.y + b.height > a.y + slack
  )
}

function expectHealthySlot(region: Bounds, slot: Slot, label: string): void {
  expect(contains(region, slot.hud), `${label} band inside region`).toBe(true)
  expect(slot.hud.height, `${label} band sized`).toBeGreaterThan(0)
  expect(overlaps(slot.hud, slot.board), `${label} band clear of board`).toBe(
    false,
  )
  expect(slot.hud.y, `${label} band above board`).toBeLessThan(slot.board.y)
  expect(contains(region, slot.board), `${label} board inside region`).toBe(
    true,
  )
  expect(contains(region, slot.swatches), `${label} row inside region`).toBe(
    true,
  )
  expect(overlaps(slot.board, slot.swatches), `${label} no overlap`).toBe(false)
  expect(slot.board.width, `${label} board square`).toBeCloseTo(
    slot.board.height,
    6,
  )
  expect(slot.board.width, `${label} board sized`).toBeGreaterThan(0)
  expect(slot.swatches.height, `${label} row sized`).toBeGreaterThan(0)
}

describe('solo layout', () => {
  it('fits a square board over its swatch row at every aspect', () => {
    for (const [name, region] of Object.entries(REGIONS)) {
      expectHealthySlot(region, computeSoloSlot(region), `solo/${name}`)
    }
  })

  it('puts the row below the board', () => {
    const slot = computeSoloSlot(REGIONS.landscape!)
    expect(slot.swatches.y).toBeGreaterThan(
      slot.board.y + slot.board.height - 1,
    )
  })

  it('tracks a region that is not at the origin', () => {
    const slot = computeSoloSlot(REGIONS.offset!)
    expect(slot.board.x).toBeGreaterThan(REGIONS.offset!.x)
    expect(slot.board.y).toBeGreaterThan(REGIONS.offset!.y)
  })
})

describe('race layout', () => {
  it('gives both players an equal, non-overlapping half', () => {
    for (const [name, region] of Object.entries(REGIONS)) {
      const { a, b } = computeRaceSlots(region)
      expectHealthySlot(region, a, `race/${name}/a`)
      expectHealthySlot(region, b, `race/${name}/b`)
      expect(a.board.width, `race/${name} equal boards`).toBeCloseTo(
        b.board.width,
        6,
      )
      expect(overlaps(a.board, b.board), `race/${name} boards apart`).toBe(
        false,
      )
      expect(overlaps(a.swatches, b.swatches), `race/${name} rows apart`).toBe(
        false,
      )
    }
  })

  it('splits along the long axis, player one first', () => {
    const { a, b } = computeRaceSlots(REGIONS.landscape!)
    expect(a.board.x).toBeLessThan(b.board.x)
  })

  it('stacks along the long axis in portrait, player one first', () => {
    const { a, b } = computeRaceSlots(REGIONS.portrait!)
    expect(a.board.y).toBeLessThan(b.board.y)
  })
})

describe('territory layout', () => {
  it('shares one square board over two separate rows', () => {
    for (const [name, region] of Object.entries(REGIONS)) {
      const { board, swatchesA, swatchesB } = computeTerritorySlots(region)
      expect(contains(region, board), `territory/${name} board`).toBe(true)
      expect(contains(region, swatchesA), `territory/${name} row a`).toBe(true)
      expect(contains(region, swatchesB), `territory/${name} row b`).toBe(true)
      expect(board.width, `territory/${name} square`).toBeCloseTo(
        board.height,
        6,
      )
      expect(overlaps(swatchesA, swatchesB), `territory/${name} rows`).toBe(
        false,
      )
      expect(overlaps(board, swatchesA), `territory/${name} a clear`).toBe(
        false,
      )
      expect(overlaps(board, swatchesB), `territory/${name} b clear`).toBe(
        false,
      )
    }
  })

  it('keeps each player to their own side of the row', () => {
    const { swatchesA, swatchesB } = computeTerritorySlots(REGIONS.landscape!)
    expect(swatchesA.x).toBeLessThan(swatchesB.x)
    expect(swatchesA.width).toBeCloseTo(swatchesB.width, 6)
  })

  it('gives the contest a bigger board than the race does', () => {
    // One shared board should read larger than either half of a split, which is
    // the whole reason the contest is worth laying out separately.
    const shared = computeTerritorySlots(REGIONS.landscape!).board
    const half = computeRaceSlots(REGIONS.landscape!).a.board
    expect(shared.width).toBeGreaterThan(half.width)
  })
})

describe('field geometry', () => {
  const board: Bounds = { x: 100, y: 200, width: 800, height: 800 }

  it('centers the cells in the board with a padded well', () => {
    const g = computeFieldGeom(board, 10, 10)
    expect(g.width).toBeLessThan(board.width)
    expect(g.x - board.x).toBeCloseTo(
      board.x + board.width - (g.x + g.width),
      6,
    )
    expect(contains(board, wellRect(g))).toBe(true)
  })

  it('keeps the drawn cell inside its pitch', () => {
    const g = computeFieldGeom(board, 14, 14)
    expect(g.cell).toBeLessThan(g.pitch)
    expect(g.cell).toBeGreaterThan(g.pitch * 0.5)
  })

  it('fits a non-square grid to the tighter axis', () => {
    const wide: Bounds = { x: 0, y: 0, width: 900, height: 300 }
    const g = computeFieldGeom(wide, 10, 10)
    expect(g.height).toBeLessThanOrEqual(wide.height)
    expect(g.width).toBeLessThanOrEqual(wide.width)
  })

  it('scales with the board', () => {
    const small = computeFieldGeom(board, 18, 18)
    const big = computeFieldGeom(
      { ...board, width: 1600, height: 1600 },
      18,
      18,
    )
    expect(big.pitch).toBeCloseTo(small.pitch * 2, 6)
  })
})

describe('cell mapping', () => {
  const g = computeFieldGeom({ x: 40, y: 60, width: 600, height: 600 }, 12, 12)

  it('round-trips a cell centre back to the same cell', () => {
    for (let row = 0; row < g.rows; row++) {
      for (let col = 0; col < g.cols; col++) {
        const c = cellCenter(g, col, row)
        expect(cellAtWorld(g, c.x, c.y)).toEqual({ col, row })
      }
    }
  })

  it('rejects a point outside the grid', () => {
    expect(cellAtWorld(g, g.x - 1, g.y + 1)).toBeNull()
    expect(cellAtWorld(g, g.x + 1, g.y - 1)).toBeNull()
    expect(cellAtWorld(g, g.x + g.width + 1, g.y + 1)).toBeNull()
    expect(cellAtWorld(g, g.x + 1, g.y + g.height + 1)).toBeNull()
  })

  it('insets the drawn cell evenly inside its pitch', () => {
    const o = cellOrigin(g, 3, 5)
    const inset = (g.pitch - g.cell) / 2
    expect(o.x).toBeCloseTo(g.x + 3 * g.pitch + inset, 6)
    expect(o.y).toBeCloseTo(g.y + 5 * g.pitch + inset, 6)
  })
})

describe('swatch row', () => {
  const row: Bounds = { x: 100, y: 900, width: 620, height: 120 }

  it('lays out square buttons, centred in the row', () => {
    for (const count of [4, 5, 6]) {
      const rects = Array.from({ length: count }, (_, i) =>
        swatchRect(row, count, i),
      )
      for (const r of rects) {
        expect(contains(row, r), `count ${count} inside`).toBe(true)
        expect(r.width, `count ${count} square`).toBeCloseTo(r.height, 6)
        expect(r.width).toBeCloseTo(rects[0]!.width, 6)
      }
      for (let i = 1; i < count; i++) {
        expect(overlaps(rects[i - 1]!, rects[i]!)).toBe(false)
      }
      // Centred: the space left of the first button matches the space right of
      // the last one.
      const first = rects[0]!
      const last = rects[count - 1]!
      expect(first.x - row.x).toBeCloseTo(
        row.x + row.width - (last.x + last.width),
        6,
      )
    }
  })

  it('takes a small share of a booth-sized row', () => {
    // The point of the change: on the real region a row of six must not sprawl
    // across the screen. Measured against the layout rather than a made-up
    // rect, since that is the only width that matters.
    const real = computeSoloSlot(REGIONS.landscape!).swatches
    const rects = Array.from({ length: 6 }, (_, i) => swatchRect(real, 6, i))
    const spanned = rects[5]!.x + rects[5]!.width - rects[0]!.x
    expect(spanned).toBeLessThan(real.width * 0.45)
    expect(rects[0]!.width).toBeCloseTo(real.height, 6)
  })

  it('leaves the board dominant over its two bands', () => {
    const slot = computeSoloSlot(REGIONS.landscape!)
    expect(slot.swatches.height).toBeLessThan(REGIONS.landscape!.height * 0.09)
    expect(slot.board.height).toBeGreaterThan(
      (slot.hud.height + slot.swatches.height) * 3,
    )
  })

  it('shrinks below the row height only when the count will not fit', () => {
    const narrow: Bounds = { x: 0, y: 0, width: 200, height: 120 }
    const r = swatchRect(narrow, 6, 0)
    expect(r.width).toBeLessThan(narrow.height)
    const rects = Array.from({ length: 6 }, (_, i) => swatchRect(narrow, 6, i))
    for (const each of rects) expect(contains(narrow, each)).toBe(true)
  })

  it('leaves a real gap between buttons', () => {
    const a = swatchRect(row, 6, 0)
    const b = swatchRect(row, 6, 1)
    expect(b.x - (a.x + a.width)).toBeGreaterThan(0)
  })
})

describe('tapping a tile', () => {
  const g = computeFieldGeom({ x: 40, y: 60, width: 600, height: 600 }, 4, 4)
  // Row-major colors: the tap has to resolve the same index the board uses.
  const colors = new Uint8Array([
    0, 1, 2, 3, 3, 2, 1, 0, 1, 1, 2, 2, 0, 3, 0, 3,
  ])

  it('reads the color of the cell under the point', () => {
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        const c = cellCenter(g, col, row)
        expect(colorAtWorld(g, colors, c.x, c.y)).toBe(colors[row * 4 + col])
      }
    }
  })

  it('resolves anywhere inside a cell, not just its centre', () => {
    const o = cellOrigin(g, 2, 1)
    expect(colorAtWorld(g, colors, o.x + 1, o.y + 1)).toBe(colors[1 * 4 + 2])
  })

  it('reports nothing outside the grid, so a tap on the frame is inert', () => {
    expect(colorAtWorld(g, colors, g.x - 5, g.y + 5)).toBeNull()
    expect(colorAtWorld(g, colors, g.x + 5, g.y - 5)).toBeNull()
    expect(colorAtWorld(g, colors, g.x + g.width + 5, g.y + 5)).toBeNull()
    expect(colorAtWorld(g, colors, g.x + 5, g.y + g.height + 5)).toBeNull()
  })
})

describe('region outline geometry', () => {
  // The outline strokes the pitch grid between tiles, with its convex corners
  // rounded to match them. Both of those only work inside a fixed budget, so the
  // budget is pinned here rather than left to the eye.
  const GRIDS: [string, number][] = [
    ['small', 10],
    ['medium', 14],
    ['large', 18],
  ]

  it('keeps the line inside the gap, off the tiles', () => {
    for (const [label, n] of GRIDS) {
      for (const region of Object.values(REGIONS)) {
        const g = computeFieldGeom(computeSoloSlot(region).board, n, n)
        const halfGap = (g.pitch - g.cell) / 2
        const halfWidth = (g.pitch * GEOM.outlineFrac) / 2
        expect(halfWidth, label).toBeLessThanOrEqual(halfGap)
      }
    }
  })

  it('leaves a straight run between two rounded corners', () => {
    // A lone owned cell rounds all four corners, so the budget is tightest
    // there: two radii have to fit inside one pitch with something left over.
    for (const [label, n] of GRIDS) {
      const g = computeFieldGeom(
        computeSoloSlot(REGIONS.landscape!).board,
        n,
        n,
      )
      const gap = (g.pitch - g.cell) / 2
      const r = Math.min(g.cell * GEOM.cellRadiusFrac + gap, g.pitch / 2)
      expect(r * 2, label).toBeLessThan(g.pitch)
      expect(r, label).toBeGreaterThan(0)
    }
  })

  it('rounds the corner concentrically with the tile', () => {
    // The stroke sits a half-gap outside the tile edge, so a concentric corner
    // is the tile's radius plus that offset.
    const g = computeFieldGeom(
      computeSoloSlot(REGIONS.landscape!).board,
      14,
      14,
    )
    const gap = (g.pitch - g.cell) / 2
    const r = Math.min(g.cell * GEOM.cellRadiusFrac + gap, g.pitch / 2)
    expect(r).toBeCloseTo(g.cell * GEOM.cellRadiusFrac + gap, 9)
  })

  it('stays clear of the well padding', () => {
    for (const [label, n] of GRIDS) {
      const g = computeFieldGeom(
        computeSoloSlot(REGIONS.landscape!).board,
        n,
        n,
      )
      expect((g.pitch * GEOM.outlineFrac) / 2, label).toBeLessThan(
        g.pitch * GEOM.wellPadFrac,
      )
      expect(contains(g.board, wellRect(g)), label).toBe(true)
    }
  })
})

describe('side margins', () => {
  it('reports the strips either side of a centred board', () => {
    const region = REGIONS.landscape!
    const { board } = computeTerritorySlots(region)
    const { left, right } = sideMargins(region, board)

    expect(left.width).toBeGreaterThan(0)
    expect(right.width).toBeGreaterThan(0)
    expect(left.width).toBeCloseTo(right.width, 6)
    expect(overlaps(left, board)).toBe(false)
    expect(overlaps(right, board)).toBe(false)
    expect(left.x + left.width).toBeCloseTo(board.x, 6)
    expect(right.x).toBeCloseTo(board.x + board.width, 6)
  })

  it('spans the region vertically, so a tally can centre on the board', () => {
    const region = REGIONS.landscape!
    const { board } = computeTerritorySlots(region)
    const { left } = sideMargins(region, board)
    const midY = board.y + board.height / 2
    expect(midY).toBeGreaterThan(left.y)
    expect(midY).toBeLessThan(left.y + left.height)
  })
})

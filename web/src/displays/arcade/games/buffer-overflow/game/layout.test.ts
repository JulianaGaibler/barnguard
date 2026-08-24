/**
 * The window, the ladder and the seat arithmetic, at every aspect the booth and
 * a developer's browser can produce.
 *
 * Every assertion runs against the whole canvas table rather than against 16:9
 * alone, because the layout's job is to hold together when the region is not
 * the shape it was designed for. The dev-tools entry is not an edge case: it is
 * the condition the game is worked on in.
 */
import { describe, expect, it } from 'vitest'
import { COLS, VISIBLE_ROWS } from './board'
import {
  computeControlRects,
  computeLayout,
  insideBuffer,
  textFloor,
  valueFloor,
  type ControlId,
  type Layout,
} from './layout'
import type { Bounds } from './types'

/**
 * The visible region for a canvas, mirroring `gameVisibleRect`.
 *
 * The region is fitted aspect-preserving into 1920 by 1080, so the result is
 * never smaller than that on either axis: a narrow canvas holds the width and
 * grows the height, a wide one does the reverse.
 */
const regionFor = (pixelW: number, pixelH: number): Bounds => {
  const scale = Math.min(pixelW / 1920, pixelH / 1080)
  const width = pixelW / scale
  const height = pixelH / scale
  return { x: 960 - width / 2, y: 540 - height / 2, width, height }
}

/** World units in one CSS pixel, which is what the text floors are measured in. */
const cssPxInWorldFor = (pixelW: number, pixelH: number): number =>
  1 / Math.min(pixelW / 1920, pixelH / 1080)

const CANVASES: [string, number, number][] = [
  ['16:9', 1920, 1080],
  ['ultrawide', 2560, 1080],
  ['4:3', 1440, 1080],
  ['portrait', 1080, 1920],
  ['tall and narrow', 800, 1600],
  ['dev tools docked', 1100, 1400],
]

const CONTROL_IDS: ControlId[] = [
  'left',
  'right',
  'softDrop',
  'rotateCCW',
  'rotateCW',
  'hardDrop',
]

const overlaps = (a: Bounds, b: Bounds): boolean =>
  a.width > 0 &&
  b.width > 0 &&
  a.x < b.x + b.width - 0.01 &&
  b.x < a.x + a.width - 0.01 &&
  a.y < b.y + b.height - 0.01 &&
  b.y < a.y + a.height - 0.01

const contains = (outer: Bounds, inner: Bounds): boolean =>
  inner.x >= outer.x - 0.01 &&
  inner.y >= outer.y - 0.01 &&
  inner.x + inner.width <= outer.x + outer.width + 0.01 &&
  inner.y + inner.height <= outer.y + outer.height + 0.01

const layoutFor = (
  pixelW: number,
  pixelH: number,
  players: 1 | 2 = 1,
  clock = false,
): Layout =>
  computeLayout({
    region: regionFor(pixelW, pixelH),
    players,
    cssPxInWorld: cssPxInWorldFor(pixelW, pixelH),
    clock,
    rightInset: 0,
  })

describe('the region itself', () => {
  it('is never smaller than the design size, whatever the canvas', () => {
    // The property the rest of the layout leans on: 16:9 is the tightest case
    // on both axes at once, so a 960-wide half is always available.
    for (const [name, w, h] of CANVASES) {
      const r = regionFor(w, h)
      expect(r.width, name).toBeGreaterThanOrEqual(1920 - 0.01)
      expect(r.height, name).toBeGreaterThanOrEqual(1080 - 0.01)
    }
  })
})

describe('the window box', () => {
  it('never runs wider than the composition inside it', () => {
    // The cap is the sum of the parts, so a window measured in cells can never
    // exceed what one seat's widest layout asks for. Anything more is void
    // beside a pane, which is invisible in a passing test and obvious on screen.
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const l = layoutFor(w, h, players)
        const s = l.seats[0]
        const perSeat = l.window.width / players / s.cell
        // Two caps, because a seat carrying ambient columns is a wider
        // composition than one without. Sizing the window for columns that then
        // drop is what would leave the void.
        expect(perSeat, name).toBeLessThanOrEqual(
          s.asideLeftTop.width > 0 ? 54.56 : 36.76,
        )
      }
    }
  })

  it('leaves an ultrawide region as margin rather than filling it', () => {
    const region = regionFor(2560, 1080)
    const l = layoutFor(2560, 1080)
    const pad = Math.min(region.width, region.height) * 0.05
    // Capped well inside what the region would allow, with the surplus sitting
    // as margin on both sides rather than being spent on wider panes.
    expect(l.window.width).toBeLessThan(
      region.width - pad * 2 - l.seats[0].cell,
    )
  })

  it('centres what it caps, on both axes', () => {
    for (const [name, w, h] of [
      ['wide', 2560, 1080],
      ['tall', 1080, 1920],
    ] as [string, number, number][]) {
      const region = regionFor(w, h)
      const win = layoutFor(w, h).window
      expect(win.x - region.x, name).toBeCloseTo(
        region.x + region.width - (win.x + win.width),
        6,
      )
      expect(win.y - region.y, name).toBeCloseTo(
        region.y + region.height - (win.y + win.height),
        6,
      )
    }
  })

  it('is wider for two seats than for one', () => {
    expect(layoutFor(2560, 1080, 2).window.width).toBeGreaterThan(
      layoutFor(2560, 1080, 1).window.width,
    )
  })

  it('never leaves the region', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        expect(
          contains(regionFor(w, h), layoutFor(w, h, players).window),
          name,
        ).toBe(true)
      }
    }
  })

  it('wraps the composition tightly, leaving no void beside a pane', () => {
    // The failure this guards is invisible in a passing layout and obvious on a
    // screen: panes capped at their maximum with the window still wider, so
    // each one sits marooned against the region edge.
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const s = layoutFor(w, h, players).seats[0]
        const gap =
          s.buffer.x -
          (s.gutter.width > 0 ? s.gutter.width + s.cell * 0.35 : 0) -
          (s.statePane.x + s.statePane.width)
        expect(gap, name).toBeLessThan(s.cell * 1.4)
      }
    }
  })
})

describe('the buffer', () => {
  it('is exactly ten by twenty cells at every aspect and seat count', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        for (const seat of layoutFor(w, h, players).seats) {
          expect(seat.buffer.width / seat.cell, name).toBeCloseTo(COLS, 6)
          expect(seat.buffer.height / seat.cell, name).toBeCloseTo(
            VISIBLE_ROWS,
            6,
          )
        }
      }
    }
  })

  it('never grows past the cap, however much room there is', () => {
    // A tall canvas hands out more vertical than twenty rows need, and an
    // uncapped buffer would grow until the overview was lost.
    const tall = layoutFor(1080, 1920).seats[0]
    expect(tall.cell).toBeLessThanOrEqual(46 + 0.01)
  })

  it('sits between the two panes without touching either', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        for (const s of layoutFor(w, h, players).seats) {
          expect(overlaps(s.buffer, s.statePane), name).toBe(false)
          expect(overlaps(s.buffer, s.statsPane), name).toBe(false)
          expect(s.statePane.x + s.statePane.width, name).toBeLessThan(
            s.buffer.x,
          )
          expect(s.statsPane.x, name).toBeGreaterThan(
            s.buffer.x + s.buffer.width,
          )
        }
      }
    }
  })
})

describe('the panes', () => {
  it('cap rather than stretching to whatever the flank offers', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h).seats[0]
      // Eleven cells is the widest a pane needs to be for a log line. Past that
      // it is a rule around a lot of nothing.
      expect(s.statePane.width / s.cell, name).toBeLessThanOrEqual(11.01)
      expect(s.statsPane.width / s.cell, name).toBeLessThanOrEqual(11.01)
    }
  })

  it('still holds a four-wide preview at the tightest seat', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h, 2).seats[0]
      expect(s.statePane.width / s.cell, name).toBeGreaterThanOrEqual(4.59)
    }
  })

  it('share the framed buffer top and bottom, so all three rules line up', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const s = layoutFor(w, h, players).seats[0]
        for (const pane of [s.statePane, s.statsPane]) {
          expect(pane.y, name).toBeCloseTo(s.bufferFrame.y, 6)
          expect(pane.height, name).toBeCloseTo(s.bufferFrame.height, 6)
        }
      }
    }
  })

  it('stands the buffer frame off its own cells', () => {
    const s = layoutFor(1920, 1080).seats[0]
    expect(s.bufferFrame.x).toBeLessThan(s.buffer.x)
    expect(s.bufferFrame.width).toBeGreaterThan(s.buffer.width)
    expect(contains(s.bufferFrame, s.buffer)).toBe(true)
  })

  it('keep every section inside the pane that owns it', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h, 1, true).seats[0]
      for (const [what, r] of [
        ['hold', s.hold],
        ['holdButton', s.holdButton],
        ['log', s.log],
        ['clock', s.clock],
      ] as const) {
        if (r.height <= 0) continue
        expect(contains(s.statePane, r), `${name} ${what}`).toBe(true)
      }
      for (const [what, r] of [
        ['next', s.next],
        ['score', s.score],
        ['level', s.level],
        ['lines', s.lines],
      ] as const) {
        if (r.height <= 0) continue
        expect(contains(s.statsPane, r), `${name} ${what}`).toBe(true)
      }
    }
  })

  it('stack their sections without overlap', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h, 1, true).seats[0]
      const left = [s.hold, s.holdButton, s.log, s.clock].filter(
        (r) => r.height > 0,
      )
      const right = [s.next, s.score, s.level, s.lines].filter(
        (r) => r.height > 0,
      )
      for (const group of [left, right]) {
        for (let i = 0; i < group.length; i++) {
          for (let j = i + 1; j < group.length; j++) {
            expect(overlaps(group[i], group[j]), name).toBe(false)
          }
        }
      }
    }
  })

  it('pins the clock to the bottom of its pane in Countdown', () => {
    const s = layoutFor(1920, 1080, 1, true).seats[0]
    const paneBottom = s.statePane.y + s.statePane.height
    expect(s.clock.y + s.clock.height).toBeLessThan(paneBottom)
    expect(s.clock.y).toBeGreaterThan(s.log.y)
  })

  it('gives the log the room a clock would have taken, in Uptime', () => {
    const withClock = layoutFor(1920, 1080, 1, true).seats[0]
    const without = layoutFor(1920, 1080, 1, false).seats[0]
    expect(without.clock.height).toBe(0)
    expect(without.log.height).toBeGreaterThan(withClock.log.height)
  })
})

describe('the address gutter', () => {
  it('appears solo, where the flank has room for it', () => {
    const s = layoutFor(1920, 1080).seats[0]
    expect(s.gutter.width).toBeGreaterThan(0)
    expect(s.gutter.height).toBeCloseTo(s.buffer.height, 6)
  })

  it('never costs the pane its minimum width', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const s = layoutFor(w, h, players).seats[0]
        if (s.gutter.width === 0) continue
        expect(s.statePane.width / s.cell, name).toBeGreaterThanOrEqual(4.59)
      }
    }
  })

  it('goes rather than shrinking its type below the floor', () => {
    // A canvas this narrow drives the floor past what eight hex characters can
    // occupy in two and a half cells, so the column is dropped whole.
    const s = layoutFor(800, 1600).seats[0]
    expect(s.gutter.width).toBe(0)
  })

  it('leaves no hole behind when it goes', () => {
    // The gutter is reserved and dropped in one place. If those ever came apart
    // the buffer would stay shifted over a column that is no longer drawn.
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const s = layoutFor(w, h, players).seats[0]
        if (s.gutter.width > 0) continue
        const gap = s.buffer.x - (s.statePane.x + s.statePane.width)
        expect(gap, name).toBeLessThan(s.cell * 1.4)
      }
    }
  })

  it('never touches the buffer it labels', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h).seats[0]
      if (s.gutter.width === 0) continue
      expect(s.gutter.x + s.gutter.width, name).toBeLessThan(s.buffer.x)
      expect(overlaps(s.gutter, s.statePane), name).toBe(false)
    }
  })
})

describe('the ambient columns', () => {
  it('fill the width a solo game cannot otherwise use', () => {
    // The whole reason they exist: height binds long before width does, so a
    // solo 16:9 window without them caps a long way inside the region and reads
    // as the game being too small for the screen.
    const region = regionFor(1920, 1080)
    const l = layoutFor(1920, 1080)
    expect(l.seats[0].asideLeftTop.width).toBeGreaterThan(0)
    expect(l.window.width).toBeGreaterThan(region.width * 0.93)
  })

  it('are solo only, since a race has no width to spare', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h, 2).seats[0]
      expect(s.asideLeftTop.width, name).toBe(0)
      expect(s.asideRight.width, name).toBe(0)
    }
  })

  it('never appear at less than a readable width', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h).seats[0]
      if (s.asideLeftTop.width === 0) continue
      expect(s.asideLeftTop.width / s.cell, name).toBeGreaterThanOrEqual(4.49)
      expect(s.asideLeftTop.width, name).toBeCloseTo(s.asideRight.width, 6)
    }
  })

  it('sit outside the working panes, never between them and the board', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h).seats[0]
      if (s.asideLeftTop.width === 0) continue
      expect(s.asideLeftTop.x + s.asideLeftTop.width, name).toBeLessThanOrEqual(
        s.statePane.x + 0.01,
      )
      expect(s.asideRight.x, name).toBeGreaterThanOrEqual(
        s.statsPane.x + s.statsPane.width - 0.01,
      )
      expect(overlaps(s.asideLeftTop, s.statePane), name).toBe(false)
      expect(overlaps(s.asideRight, s.statsPane), name).toBe(false)
    }
  })

  it('never cost the working pane a pixel of its width', () => {
    // Decoration is served last, out of what is left once the pane has taken
    // its full width. So wherever a column appears at all, the pane beside it
    // is at its cap: the two can never be in competition.
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h).seats[0]
      if (s.asideLeftTop.width === 0) continue
      expect(s.statePane.width / s.cell, name).toBeCloseTo(11, 6)
      expect(s.statsPane.width / s.cell, name).toBeCloseTo(11, 6)
    }
  })

  it('go rather than squeeze, when the flank cannot hold both', () => {
    // A race splits the region in two, which leaves no seat enough width for a
    // column that is only decoration.
    const s = layoutFor(1920, 1080, 2).seats[0]
    expect(s.asideLeftTop.width).toBe(0)
    expect(s.statePane.width / s.cell).toBeGreaterThanOrEqual(4.49)
  })

  it('span the framed buffer top to bottom, as two stacked windows', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h).seats[0]
      if (s.asideLeftTop.width === 0) continue
      const top = s.asideLeftTop
      const bottom = s.asideLeftBottom
      expect(top.y, name).toBeCloseTo(s.bufferFrame.y, 6)
      expect(bottom.y + bottom.height, name).toBeCloseTo(
        s.bufferFrame.y + s.bufferFrame.height,
        6,
      )
      // Stacked with clear air between them, never touching.
      expect(bottom.y, name).toBeGreaterThan(top.y + top.height)
      expect(overlaps(top, bottom), name).toBe(false)
      // The graph opposite runs the full height on its own.
      expect(s.asideRight.height, name).toBeCloseTo(s.bufferFrame.height, 6)
    }
  })
})

describe('the degradation ladder', () => {
  it('gives the log three rows or none', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const l = layoutFor(w, h, players, true)
        const s = l.seats[0]
        if (l.chrome.logLines === 0) {
          expect(s.log.height, name).toBe(0)
        } else {
          expect(l.chrome.logLines, name).toBeGreaterThanOrEqual(3)
        }
      }
    }
  })

  it('never shows more queue than the game has, or less than one', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const c = layoutFor(w, h, players).chrome
        expect(c.queueCount, name).toBeGreaterThanOrEqual(1)
        expect(c.queueCount, name).toBeLessThanOrEqual(5)
      }
    }
  })

  it('drops chrome as the type floor grows, and keeps what plays the game', () => {
    // A viewport a fifth of the design width forces every floor up fivefold,
    // which is the small-window case taken past anything real.
    const region = regionFor(1920, 1080)
    const roomy = computeLayout({
      region,
      players: 1,
      cssPxInWorld: 1,
      clock: true,
      rightInset: 0,
    })
    const cramped = computeLayout({
      region,
      players: 1,
      cssPxInWorld: 5,
      clock: true,
      rightInset: 0,
    })

    expect(cramped.chrome.logLines).toBeLessThanOrEqual(roomy.chrome.logLines)
    expect(cramped.chrome.queueCount).toBeLessThanOrEqual(
      roomy.chrome.queueCount,
    )
    expect(cramped.chrome.statusFields).toBeLessThanOrEqual(
      roomy.chrome.statusFields,
    )

    // Whatever else goes, these three are how the game is played.
    const s = cramped.seats[0]
    expect(s.buffer.width).toBeGreaterThan(0)
    expect(s.controls.height).toBeGreaterThan(0)
    expect(s.score.height).toBeGreaterThan(0)
  })

  it('measures its floors in CSS pixels, not world units', () => {
    // The whole point: the region is a fixed world size but an arbitrary number
    // of CSS pixels, so a smaller canvas has to ask for larger world-unit type.
    expect(textFloor(2.4)).toBeCloseTo(textFloor(1) * 2.4, 6)
    expect(valueFloor(1)).toBeGreaterThan(textFloor(1))
  })
})

describe('the bars', () => {
  it('shares the window edges, so the screen reads as one window', () => {
    for (const [name, w, h] of CANVASES) {
      const l = layoutFor(w, h)
      expect(l.header.x, name).toBeCloseTo(l.window.x, 6)
      if (l.status.height > 0) {
        expect(l.status.x, name).toBeCloseTo(l.window.x, 6)
        expect(l.status.width, name).toBeCloseTo(l.window.width, 6)
      }
    }
  })

  it('stops the header short of the pause cap rather than running under it', () => {
    const region = regionFor(1920, 1080)
    const inset = 260
    const l = computeLayout({
      region,
      players: 1,
      cssPxInWorld: 1,
      clock: false,
      rightInset: inset,
    })
    expect(l.header.x + l.header.width).toBeLessThanOrEqual(
      region.x + region.width - inset + 0.01,
    )
  })

  it('leaves the seats clear of both bars', () => {
    for (const [name, w, h] of CANVASES) {
      const l = layoutFor(w, h)
      const s = l.seats[0]
      expect(s.statePane.y, name).toBeGreaterThan(l.header.y + l.header.height)
      if (l.status.height > 0) {
        expect(s.controls.y + s.controls.height, name).toBeLessThanOrEqual(
          l.status.y + 0.01,
        )
      }
    }
  })
})

describe('the control grid', () => {
  it('pairs each direction with the turn that goes the same way', () => {
    const r = computeControlRects(layoutFor(1920, 1080).seats[0].controlsBody)
    const adjacent = (a: Bounds, b: Bounds): number =>
      Math.min(Math.abs(b.x - (a.x + a.width)), Math.abs(a.x - (b.x + b.width)))
    // Each hand's two caps touch, and the gap to anything else is wider.
    const leftPair = adjacent(r.left, r.rotateCCW)
    const rightPair = adjacent(r.right, r.rotateCW)
    expect(leftPair).toBeCloseTo(rightPair, 6)
    expect(adjacent(r.rotateCCW, r.softDrop)).toBeGreaterThan(leftPair * 2)
    expect(adjacent(r.rotateCW, r.hardDrop)).toBeGreaterThan(rightPair * 2)
  })

  it('mirrors the two hands about the drops', () => {
    const body = layoutFor(1920, 1080).seats[0].controlsBody
    const r = computeControlRects(body)
    const mid =
      r.softDrop.x + (r.hardDrop.x + r.hardDrop.width - r.softDrop.x) / 2
    expect(mid - (r.rotateCCW.x + r.rotateCCW.width)).toBeCloseTo(
      r.rotateCW.x - mid,
      6,
    )
    expect(mid - (r.left.x + r.left.width)).toBeCloseTo(r.right.x - mid, 6)
  })

  it('puts the two drops between the hands', () => {
    const body = layoutFor(1920, 1080).seats[0].controlsBody
    const r = computeControlRects(body)
    expect(r.rotateCCW.x).toBeGreaterThan(r.left.x)
    expect(r.softDrop.x).toBeGreaterThan(r.rotateCCW.x)
    expect(r.hardDrop.x).toBeGreaterThan(r.softDrop.x)
    expect(r.rotateCW.x).toBeGreaterThan(r.hardDrop.x)
    expect(r.right.x).toBeGreaterThan(r.rotateCW.x)
  })

  it('draws every cap as the same square', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const r = computeControlRects(
          layoutFor(w, h, players).seats[0].controlsBody,
        )
        const side = r.left.width
        for (const id of CONTROL_IDS) {
          expect(r[id].width, `${name} ${id}`).toBeCloseTo(side, 6)
          expect(r[id].height, `${name} ${id}`).toBeCloseTo(side, 6)
          expect(r[id].y, `${name} ${id}`).toBeCloseTo(r.left.y, 6)
        }
      }
    }
  })

  it('holds the hands off the drops by more than it splits a pair', () => {
    const r = computeControlRects(layoutFor(1920, 1080).seats[0].controlsBody)
    const pair = r.rotateCCW.x - (r.left.x + r.left.width)
    const group = r.softDrop.x - (r.rotateCCW.x + r.rotateCCW.width)
    expect(group).toBeGreaterThan(pair * 2)
  })

  it('never overlaps two buttons', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const r = computeControlRects(
          layoutFor(w, h, players).seats[0].controlsBody,
        )
        for (let i = 0; i < CONTROL_IDS.length; i++) {
          for (let j = i + 1; j < CONTROL_IDS.length; j++) {
            const a = r[CONTROL_IDS[i]]
            const b = r[CONTROL_IDS[j]]
            expect(
              overlaps(a, b),
              `${name} ${CONTROL_IDS[i]}/${CONTROL_IDS[j]}`,
            ).toBe(false)
          }
        }
      }
    }
  })

  it('leaves less air above and below than beside', () => {
    // The composition runs out of width long before it runs out of height, so
    // an even margin would be spending the one it has spare to match the one it
    // does not.
    const region = regionFor(1920, 1080)
    const l = layoutFor(1920, 1080)
    const side = l.window.x - region.x
    const top = l.window.y - region.y
    expect(side).toBeGreaterThan(0)
    expect(top).toBeLessThan(side * 2)
  })

  it('spends leftover height on the seam, not on the margin', () => {
    const l = layoutFor(1920, 1080)
    const s = l.seats[0]
    const seam = s.controls.y - (s.bufferFrame.y + s.bufferFrame.height)
    // Wide enough to read as deliberate, and capped before it reads as a hole.
    expect(seam).toBeGreaterThan(s.cell)
    expect(seam).toBeLessThanOrEqual(s.cell * 2.2 + 1e-6)
  })

  it('caps the seam rather than tracking a very tall region', () => {
    // A portrait canvas has height to burn. The seam must not scale with it.
    const wide = layoutFor(1920, 1080).seats[0]
    const tall = layoutFor(1100, 1400).seats[0]
    const seamOf = (s: typeof wide): number =>
      s.controls.y - (s.bufferFrame.y + s.bufferFrame.height)
    expect(seamOf(tall)).toBeCloseTo(seamOf(wide), 6)
  })

  it('never lets a button fall below a fingertip', () => {
    for (const [name, w, h] of CANVASES) {
      for (const players of [1, 2] as const) {
        const r = computeControlRects(
          layoutFor(w, h, players).seats[0].controlsBody,
        )
        for (const id of CONTROL_IDS) {
          // Squares in one row, so a cap is the whole band height rather than
          // half of it. Halving the band cost nothing in target size once the
          // pairs stopped being stacked.
          expect(
            Math.min(r[id].width, r[id].height),
            `${name} ${id}`,
          ).toBeGreaterThan(60)
        }
      }
    }
  })

  it('sits inside the band that frames it', () => {
    for (const [name, w, h] of CANVASES) {
      const s = layoutFor(w, h).seats[0]
      expect(contains(s.controls, s.controlsBody), name).toBe(true)
    }
  })
})

describe('buffer hit testing', () => {
  it('accepts points inside and rejects points outside', () => {
    const s = layoutFor(1920, 1080).seats[0]
    const b = s.buffer
    expect(insideBuffer(s, b.x + b.width / 2, b.y + b.height / 2)).toBe(true)
    expect(insideBuffer(s, b.x - 1, b.y + 1)).toBe(false)
    expect(insideBuffer(s, b.x + 1, b.y + b.height + 1)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'
import type { Gfx2D } from '@src/stargazer'
import { CardNode } from './CardNode'
import { BODY_SIZE_FRACS, cardFace } from '../cardFace'
import { COLORS } from '../tuning'
import { DECK } from '../rules/deck'

describe('a card in motion', () => {
  const home = { x: 40, y: 60, width: 200, height: 303 }

  it('starts settled at its home and reports no motion', () => {
    const node = new CardNode('t')
    node.setHome(home)
    node.snapHome()
    expect(node.animating).toBe(false)
    expect(node.transform.x).toBe(home.x)
    expect(node.visualRect()).toEqual(home)
  })

  // A scaled card covers less than the layout gave it, and a hit test that
  // reads the home rect would answer for space the card is not in.
  it('reports the space it covers, not the space it was given', () => {
    const node = new CardNode('t')
    node.setHome(home)
    node.snapHome()
    node.transform.scaleX = 0.5
    node.transform.scaleY = 0.5
    const r = node.visualRect()
    expect(r.width).toBeCloseTo(home.width / 2, 6)
    expect(r.height).toBeCloseTo(home.height / 2, 6)
  })

  it('takes its home size from the rect it is given', () => {
    const node = new CardNode('t')
    node.setHome(home)
    expect(node.width).toBe(home.width)
    expect(node.height).toBe(home.height)
  })
})

describe('cardFace geometry', () => {
  const g = cardFace(256, 388)

  it('centres the portrait and puts the coin in the panel corner', () => {
    expect(g.portrait.cx).toBeCloseTo(128, 3)
    expect(g.portraitBox.x + g.portraitBox.width / 2).toBeCloseTo(
      g.portrait.cx,
      3,
    )
    expect(g.coin.cx - g.coin.r).toBeGreaterThan(g.artPanel.x)
    expect(g.coin.cy - g.coin.r).toBeGreaterThan(g.artPanel.y)
  })

  it('keeps the portrait pixel box square and inside its disc', () => {
    expect(g.portraitBox.width).toBeCloseTo(g.portraitBox.height, 6)
    // The box is bottom-heavy against the disc, so the shoulders crop rather
    // than the face sitting high in the circle.
    expect(g.portraitBox.width).toBeLessThan(g.portrait.r * 2)
    expect(g.portraitBox.y).toBeGreaterThan(g.portrait.cy - g.portrait.r)
  })

  // The upper half is compressed against the reference art so the on-hire band
  // can hold two lines of symbols. These pin the stack that compression has to
  // keep in order, not the figures it was free to move.
  it('stacks the face top to bottom without overlaps', () => {
    const spans: [string, number, number][] = [
      ['lanyard', g.lanyard.y, g.lanyard.y + g.lanyard.height],
      ['panel', g.artPanel.y, g.artPanel.y + g.artPanel.height],
      ['name', g.nameBox.y, g.nameBox.y + g.nameBox.height],
      ['onHire', g.onHire.y, g.onHire.y + g.onHire.height],
      ['review', g.reviewBand.y, g.reviewBand.y + g.reviewBand.height],
    ]
    for (const [name, top, bottom] of spans) {
      expect(bottom, name).toBeGreaterThan(top)
      expect(top, name).toBeGreaterThanOrEqual(0)
      expect(bottom, name).toBeLessThanOrEqual(388)
    }
    expect(g.nameBox.y).toBeGreaterThan(g.artPanel.y + g.artPanel.height)
    expect(g.divider.y).toBeGreaterThan(g.nameBox.y + g.nameBox.height)
    expect(g.onHire.y).toBeGreaterThan(g.divider.y)
    expect(g.reviewBand.y).toBeGreaterThan(g.onHire.y + g.onHire.height)
  })

  // The elevator marks a card that sends the marker across, and it lives in the
  // one gap left between the lanyard slot and the portrait disc.
  it('fits the elevator between the lanyard and the portrait', () => {
    const e = g.elevator
    expect(e.y).toBeGreaterThan(g.lanyard.y + g.lanyard.height)
    expect(e.y + e.height).toBeLessThan(g.portrait.cy - g.portrait.r)
    expect(e.x + e.width / 2).toBeCloseTo(128, 3)
    // Clear of the coin on one side and the badges on the other.
    expect(e.x).toBeGreaterThan(g.coin.cx + g.coin.r)
    expect(e.x + e.width).toBeLessThan(g.badgeX)
  })

  it('keeps the floor mark inside the art panel', () => {
    expect(g.floorMark.y).toBeGreaterThan(g.artPanel.y)
    expect(g.floorMark.y + g.floorMark.height).toBeLessThan(
      g.artPanel.y + g.artPanel.height,
    )
  })

  it('gives the on-hire band room for two lines of the largest body size', () => {
    // Two lines of symbols is the shape the compression exists to fit, and the
    // glyphs on such a line run to about 1.45 em.
    const size = BODY_SIZE_FRACS[0]! * 256
    expect(g.onHire.height).toBeGreaterThan(size * 1.45 * 2)
  })

  it('puts the review text right of the points chip, inside the band', () => {
    expect(g.pointsChip.x).toBe(g.reviewBand.x)
    expect(g.reviewText.x).toBeGreaterThan(g.pointsChip.x + g.pointsChip.width)
    expect(g.reviewText.x + g.reviewText.width).toBeLessThanOrEqual(
      g.reviewBand.x + g.reviewBand.width + 1e-6,
    )
  })

  it('scales linearly with the card', () => {
    const a = cardFace(200, 300)
    const b = cardFace(400, 600)
    expect(b.coin.cx).toBeCloseTo(a.coin.cx * 2, 6)
    expect(b.reviewBand.width).toBeCloseTo(a.reviewBand.width * 2, 6)
  })
})

describe('CardNode', () => {
  it('holds the face it is given', () => {
    const node = new CardNode('t')
    const card = DECK[0]!
    node.setFace({ kind: 'card', card, budget: 0 })
    expect(node.face).toEqual({ kind: 'card', card, budget: 0 })
  })

  it('sizes itself and bounds a shadow bleed', () => {
    const node = new CardNode('t')
    node.setSize(200, 303)
    expect(node.width).toBe(200)
    expect(node.height).toBe(303)
    expect(node.debugBounds!.x).toBeLessThan(0)
    expect(node.debugBounds!.width).toBeGreaterThan(200)
  })

  it('hit-tests the card rect', () => {
    const node = new CardNode('t')
    node.setFace({ kind: 'openSeat' })
    node.setSize(200, 303)
    expect(node.hitTest(100, 150, 0)).toBe(true)
    expect(node.hitTest(-5, 10, 0)).toBe(false)
    expect(node.hitTest(210, 10, 0)).toBe(false)
  })
})

interface RecordedRect {
  x: number
  y: number
  w: number
  h: number
  color: string
}

/** A Gfx2D that records `fillRect` and no-ops everything else. */
function recordingGfx(deviceScale: number): {
  gfx: Gfx2D
  rects: RecordedRect[]
} {
  const rects: RecordedRect[] = []
  const gfx = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === 'fillRect') {
          return (
            x: number,
            y: number,
            w: number,
            h: number,
            color: string,
          ): void => {
            rects.push({ x, y, w, h, color })
          }
        }
        if (prop === 'snapSize') {
          return (v: number): number =>
            Math.max(1, Math.round(v * deviceScale)) / deviceScale
        }
        if (prop === 'deviceScale') return (): number => deviceScale
        return (): undefined => undefined
      },
    },
  ) as Gfx2D
  return { gfx, rects }
}

describe('CardNode portrait grid', () => {
  // 178.35 world units is the card width at a 1920x1080 region, and 1.333
  // device px per world unit is a 2560x1440 canvas. That puts the raw cell at
  // 6.27 device px, where an unsnapped grid gives columns of 6 or 7 px.
  const W = 178.353
  const H = W * (388 / 256)
  const SCALE = 4 / 3

  // The disc behind the face is filled inside the same clip, so it arrives as a
  // `fillRect` too, and only the pixel strips are the grid under test.
  const portraitRects = (): RecordedRect[] => {
    const node = new CardNode('t')
    node.setSize(W, H)
    node.setFace({ kind: 'card', card: DECK[0]!, budget: 0 })
    const { gfx, rects } = recordingGfx(SCALE)
    node.draw(gfx)
    return rects.filter((r) => r.color !== COLORS.portraitDisc)
  }

  it('draws every portrait cell one whole device pixel tall', () => {
    const rects = portraitRects()
    expect(rects.length).toBeGreaterThan(10)
    for (const r of rects) {
      expect(Math.abs(r.h * SCALE - Math.round(r.h * SCALE))).toBeLessThan(1e-9)
    }
  })

  it('gives every cell the same width, so no column is a pixel wider', () => {
    const rects = portraitRects()
    const cell = rects[0]!.h
    for (const r of rects) {
      expect(r.h).toBeCloseTo(cell, 9)
      expect(r.w / cell).toBeCloseTo(Math.round(r.w / cell), 9)
    }
  })

  it('keeps the snapped grid centred on the portrait disc', () => {
    const rects = portraitRects()
    const g = cardFace(W, H)
    const cell = rects[0]!.h
    const left = Math.min(...rects.map((r) => r.x))
    const right = Math.max(...rects.map((r) => r.x + r.w))
    // The art does not fill all 16 columns, so bound rather than equate.
    expect(left).toBeGreaterThanOrEqual(g.portrait.cx - cell * 8 - 1e-9)
    expect(right).toBeLessThanOrEqual(g.portrait.cx + cell * 8 + 1e-9)
  })

  it('falls back to the unsnapped cell when the device scale is unknown', () => {
    const node = new CardNode('t')
    node.setSize(W, H)
    node.setFace({ kind: 'card', card: DECK[0]!, budget: 0 })
    const rects: { h: number }[] = []
    const gfx = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'fillRect') {
            return (
              _x: number,
              _y: number,
              _w: number,
              h: number,
              color: string,
            ): void => {
              // Skip the disc filled behind the face inside the same clip.
              if (color !== COLORS.portraitDisc) rects.push({ h })
            }
          }
          if (prop === 'snapSize') return (v: number): number => v
          if (prop === 'deviceScale') return (): number => 1
          return (): undefined => undefined
        },
      },
    ) as Gfx2D
    node.draw(gfx)
    expect(rects[0]!.h).toBeCloseTo(cardFace(W, H).portraitBox.width / 16, 9)
  })
})

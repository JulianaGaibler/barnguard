import { describe, expect, it } from 'vitest'
import {
  blendKey,
  CONTENT_WIDTH,
  fullKey,
  layoutFor,
  maxStripScroll,
  restKey,
  segmentsAt,
  stripKey,
  type Box,
} from './layout'

const SIZES = [
  { width: 1440, height: 1080 },
  { width: 1728, height: 1080 },
  { width: 1920, height: 1080 },
  { width: 2400, height: 1080 },
]

function inside(box: Box, width: number, height: number): boolean {
  return (
    box.x >= -0.001 &&
    box.y >= -0.001 &&
    box.x + box.width <= width + 0.001 &&
    box.y + box.height <= height + 0.001
  )
}

function overlap(a: Box, b: Box): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  )
}

describe('layoutFor', () => {
  it('matches the Figma frame at 1440 by 1080', () => {
    const l = layoutFor(SIZES[0]!)
    expect(l.banner.logo.x).toBeCloseTo(681.5)
    expect(l.rowY).toBe(970)
    expect(l.pitch).toBe(1026)
    expect(l.hud.time.x).toBeCloseTo(1342)
    expect(l.hud.score.x).toBeCloseTo(1238)
    expect(l.scale[0]!.x).toBeCloseTo(451.5)
  })

  for (const size of SIZES) {
    describe(`at ${size.width} by ${size.height}`, () => {
      const l = layoutFor(size)

      it('keeps the row inside the screen and apart', () => {
        const buttons = l.buttons.map((s) => ({ ...s }))
        for (const b of buttons)
          expect(inside(b, size.width, size.height)).toBe(true)
        for (const s of l.scale)
          expect(inside(s, size.width, size.height)).toBe(true)
        const hud: Box = {
          x: l.hud.score.x - 44,
          y: l.hud.score.y - 44,
          width: l.hud.time.x + 44 - (l.hud.score.x - 44),
          height: 88,
        }
        expect(inside(hud, size.width, size.height)).toBe(true)
        for (const b of buttons) expect(overlap(b, hud)).toBe(false)
        for (const s of l.scale) expect(overlap(s, hud)).toBe(false)
      })

      it('centers the scale and the card', () => {
        const first = l.scale[0]!
        const last = l.scale[2]!
        expect((first.x + last.x + last.width) / 2).toBeCloseTo(size.width / 2)
        const rest = restKey(l, l.restCenter.x)
        expect(rest.box.x + rest.box.width / 2).toBeCloseTo(size.width / 2)
        expect(rest.box.y + rest.box.height / 2).toBeCloseTo(size.height / 2)
      })

      it('keeps the banner above the card at rest', () => {
        const rest = restKey(l, l.restCenter.x)
        expect(l.banner.logo.y + l.banner.logo.height).toBeLessThan(rest.box.y)
      })

      it('keeps the card clear of the row at rest', () => {
        const rest = restKey(l, l.restCenter.x)
        expect(rest.box.y + rest.box.height).toBeLessThan(l.buttons[0]!.y)
      })

      it('sets the splash cards below the banner and inside the screen', () => {
        const cards = l.splash.cards
        const bannerBottom = l.banner.logo.y + l.banner.logo.height
        expect(cards[0]!.y).toBeGreaterThanOrEqual(bannerBottom + 48)
        const last = cards[cards.length - 1]!
        expect(last.y + last.height).toBeLessThanOrEqual(l.height)
        for (let i = 1; i < cards.length; i++) {
          expect(cards[i]!.y).toBeGreaterThan(
            cards[i - 1]!.y + cards[i - 1]!.height,
          )
        }
      })

      it('shows part of each splash card', () => {
        for (const card of l.splash.cards) {
          expect(card.x).toBeLessThan(size.width)
          expect(card.x).toBeGreaterThan(size.width / 2)
        }
      })
    })
  }

  it('keeps the safe area clear', () => {
    const l = layoutFor(SIZES[0]!, { top: 24, right: 30, bottom: 20, left: 40 })
    expect(l.banner.logo.y).toBe(88)
    expect(l.banner.left).toBe(168)
    expect(l.rowY).toBe(950)
    expect(l.hud.time.x + 44).toBe(1440 - 54 - 30)
  })
})

describe('card keyframes', () => {
  const l = layoutFor(SIZES[0]!)

  it('lays the full screen text out at the width the other keyframes scale', () => {
    const full = fullKey(l)
    const rest = restKey(l, 720)
    const strip = stripKey(l, 0, 0)
    for (const key of [full, rest, strip]) {
      const used = CONTENT_WIDTH * key.scale
      expect(key.contentX * 2 + used).toBeCloseTo(key.box.width, 0)
    }
  })

  it('blends between two keyframes', () => {
    const a = restKey(l, 720)
    const b = fullKey(l)
    expect(blendKey(a, b, 0)).toEqual(a)
    expect(blendKey(a, b, 1)).toEqual(b)
    const mid = blendKey(a, b, 0.5)
    expect(mid.radius).toBeCloseTo((a.radius + b.radius) / 2)
    expect(mid.scale).toBeCloseTo((a.scale + b.scale) / 2)
  })

  it('moves a strip card by the scroll', () => {
    expect(stripKey(l, 2, 100).box.x).toBe(stripKey(l, 2, 0).box.x - 100)
  })
})

describe('maxStripScroll', () => {
  const l = layoutFor(SIZES[0]!)

  it('is 0 while the cards fit', () => {
    expect(maxStripScroll(l, 1)).toBe(0)
    expect(maxStripScroll(l, 3)).toBe(0)
  })

  it('grows with the cards', () => {
    expect(maxStripScroll(l, 10)).toBeGreaterThan(maxStripScroll(l, 6))
  })
})

describe('segmentsAt', () => {
  const l = layoutFor(SIZES[0]!)

  it('is the buttons at 0 and the scale at 1', () => {
    expect(segmentsAt(l, 0)).toEqual(l.buttons)
    expect(segmentsAt(l, 1)).toEqual(l.scale)
  })

  it('has the scale touching end to end', () => {
    const s = segmentsAt(l, 1)
    expect(s[0]!.x + s[0]!.width).toBeCloseTo(s[1]!.x)
    expect(s[1]!.x + s[1]!.width).toBeCloseTo(s[2]!.x)
  })

  it('never rounds a corner past half the height', () => {
    for (const t of [0, 0.25, 0.5, 0.75, 1]) {
      for (const s of segmentsAt(l, t)) {
        for (const r of s.radii)
          expect(r).toBeLessThanOrEqual(s.height / 2 + 0.001)
      }
    }
  })
})

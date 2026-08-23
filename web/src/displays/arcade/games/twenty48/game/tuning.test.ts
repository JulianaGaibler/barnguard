import { describe, expect, it } from 'vitest'
import { parseColor, type RGBA } from '@src/stargazer'
import { relativeLuminance, type Rgba } from '../../../background/palette'
import {
  ACCENT_VS,
  ANIM,
  BEVEL,
  BURST,
  COLORS,
  GOAL,
  exponentOf,
  RULES,
  TILE_COLORS,
  tileColor,
  tileDepth,
  tileInk,
  tileSkirt,
} from './tuning'

const rgba = (css: string): Rgba => {
  const c: RGBA = parseColor(css)
  return [c.r * 255, c.g * 255, c.b * 255, c.a]
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [relativeLuminance(rgba(a)), relativeLuminance(rgba(b))]
  return x > y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05)
}

/** A numeral fills its cell, so it counts as large text. */
const AA_LARGE = 3

/** Every value the ramp is meant to cover, 2 through 2048. */
const VALUES = Array.from({ length: 11 }, (_, i) => 2 ** (i + 1))

describe('the tile ramp', () => {
  it('covers every value up to the win tile', () => {
    for (const v of VALUES) {
      expect(TILE_COLORS[exponentOf(v)], String(v)).toMatch(/^#[0-9A-Fa-f]{6}$/)
    }
    // Two separate claims, kept separate: the warm ramp runs out at 2048, and
    // whatever the win tile is set to has a color on it.
    expect(VALUES.at(-1)).toBe(2048)
    expect(VALUES).toContain(RULES.winValue)
  })

  it('clamps past the end of the ramp instead of falling off it', () => {
    const beyond = tileColor(4096)
    expect(beyond).toMatch(/^#[0-9A-Fa-f]{6}$/)
    expect(tileColor(8192)).toBe(beyond)
    expect(tileColor(65_536)).toBe(beyond)
  })

  it('gives every step a distinct fill', () => {
    const seen = new Set(VALUES.map(tileColor))
    expect(seen.size).toBe(VALUES.length)
  })

  it('reads the numeral against its own tile at every step', () => {
    for (const v of VALUES) {
      expect(
        contrast(tileInk(v), tileColor(v)),
        String(v),
      ).toBeGreaterThanOrEqual(AA_LARGE)
    }
    expect(contrast(tileInk(4096), tileColor(4096))).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
  })

  it('keeps the dark ink across the warm ramp and flips only past it', () => {
    // The classic ramp puts white on the orange steps, which does not clear AA
    // anywhere on it. Only the past-2048 fill is dark enough to need light ink.
    for (const v of VALUES) expect(tileInk(v), String(v)).toBe(COLORS.ink)
    expect(tileInk(4096)).toBe(COLORS.inkLight)
  })

  it('separates a tile from its well with the skirt', () => {
    // The faces themselves sit close to the well in luminance, which is fine:
    // the extruded side is what makes a tile read as sitting in the pocket.
    for (const v of VALUES) {
      expect(contrast(tileSkirt(v), COLORS.well), String(v)).toBeGreaterThan(
        1.5,
      )
    }
  })

  it('darkens the skirt clearly against its own face', () => {
    for (const v of VALUES) {
      expect(contrast(tileSkirt(v), tileColor(v)), String(v)).toBeGreaterThan(
        1.7,
      )
    }
  })
})

describe('extrusion depth', () => {
  const CELL = 160

  it('grows with the value', () => {
    expect(tileDepth(CELL, 4)).toBeGreaterThan(tileDepth(CELL, 2))
    expect(tileDepth(CELL, 2048)).toBeGreaterThan(tileDepth(CELL, 128))
  })

  it('leaves most of the tile as top face even at the deepest step', () => {
    // The extrusion is taken out of the tile's own square rather than added
    // below it, so too deep a side would squash the face it belongs to.
    const deepest = tileDepth(CELL, 2048)
    expect(deepest).toBeCloseTo(CELL * BEVEL.maxDepthFrac, 6)
    expect(CELL - deepest).toBeGreaterThan(CELL * 0.75)
  })

  it('scales with the cell, so a versus board looks the same as a solo one', () => {
    expect(tileDepth(320, 64)).toBeCloseTo(tileDepth(160, 64) * 2, 6)
  })
})

describe('versus accents', () => {
  it('gives the two seats plainly different hues', () => {
    // Luminance ratio is the wrong measure for two accents that only have to
    // be told apart from each other, so compare the colors themselves.
    const a = parseColor(ACCENT_VS[1])
    const b = parseColor(ACCENT_VS[2])
    const distance = Math.hypot(a.r - b.r, a.g - b.g, a.b - b.b)
    expect(distance).toBeGreaterThan(0.4)
  })

  it('reads each seat against the background', () => {
    expect(contrast(ACCENT_VS[1], COLORS.background)).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
    expect(contrast(ACCENT_VS[2], COLORS.background)).toBeGreaterThanOrEqual(
      AA_LARGE,
    )
  })
})

describe('celebration thresholds', () => {
  it('reacts to the very first merge a player can make', () => {
    // 4 is the smallest value a merge can produce, so a burst on every merge.
    expect(RULES.burstFrom).toBeLessThanOrEqual(4)
  })

  it('keeps the goal at 2048 even though the small reactions start early', () => {
    expect(RULES.winValue).toBe(2048)
    expect(RULES.milestoneFrom).toBeLessThan(RULES.winValue)
    expect(ANIM.caPulseFrom).toBeLessThan(RULES.winValue)
  })

  it('holds the goal cascade and rain well clear of a merge burst', () => {
    // The goal has to out-class a milestone, which now fires from 8 upward.
    expect(GOAL.rainDurationSec).toBeGreaterThan(ANIM.pop * 3)
    expect(GOAL.rainCount).toBeGreaterThan(BURST.maxCount * 2)
  })

  it('rains downward, and keeps accelerating', () => {
    expect(GOAL.rainMinSpeed).toBeGreaterThan(0)
    expect(GOAL.rainMaxSpeed).toBeGreaterThan(GOAL.rainMinSpeed)
    expect(GOAL.rainGravity).toBeGreaterThan(0)
  })
})

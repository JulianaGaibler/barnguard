/**
 * Contrast checks for the game's own palette, using the technique in
 * `displays/arcade/theme.test.ts`.
 *
 * Two things are being protected. The seven piece colors have to stand off a
 * near-black buffer AND off each other, because on a settled stack the shape
 * that made a cell is long gone and color is all that separates one region from
 * the next. And the DOM chrome has to stay readable, which is easy to break by
 * nudging one accent.
 */
import { describe, expect, it } from 'vitest'
import { parseColor, type RGBA } from '@src/stargazer'
import { relativeLuminance, type Rgba } from '../../background/palette'
import { BUFFER_OVERFLOW_PALETTE } from './palette'
import {
  accentForLevel,
  ACCENT_RAMP,
  COLORS,
  PIECE_COLORS,
} from './game/tuning'
import type { PieceKind } from './game/types'

const rgba = (css: string): Rgba => {
  const c: RGBA = parseColor(css)
  return [c.r * 255, c.g * 255, c.b * 255, c.a]
}

const contrast = (a: string, b: string): number => {
  const [x, y] = [relativeLuminance(rgba(a)), relativeLuminance(rgba(b))]
  return x > y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05)
}

/** Rough perceptual distance, enough to catch two hues that read alike. */
const separation = (a: string, b: string): number => {
  const [ar, ag, ab] = rgba(a)
  const [br, bg, bb] = rgba(b)
  // Weighted toward green, which is where the eye resolves the most detail.
  return Math.sqrt(2 * (ar - br) ** 2 + 4 * (ag - bg) ** 2 + 3 * (ab - bb) ** 2)
}

const AA = 4.5
const AA_LARGE = 3

const KINDS = Object.keys(PIECE_COLORS) as PieceKind[]

describe('piece colors', () => {
  it('stand off the buffer they sit in', () => {
    for (const kind of KINDS) {
      expect(
        contrast(PIECE_COLORS[kind], COLORS.buffer),
        kind,
      ).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('stand off the backdrop behind the board', () => {
    for (const kind of KINDS) {
      expect(
        contrast(PIECE_COLORS[kind], COLORS.backdropTop),
        kind,
      ).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('are distinguishable from each other', () => {
    // On a settled stack the shape is gone and color is the only thing left
    // separating one player's region from the next.
    const MIN_SEPARATION = 90
    for (let i = 0; i < KINDS.length; i++) {
      for (let j = i + 1; j < KINDS.length; j++) {
        const a = KINDS[i]
        const b = KINDS[j]
        expect(
          separation(PIECE_COLORS[a], PIECE_COLORS[b]),
          `${a} vs ${b}`,
        ).toBeGreaterThan(MIN_SEPARATION)
      }
    }
  })
})

describe('the level accent ramp', () => {
  it('reads against the pane it rules at every level', () => {
    for (let level = 1; level <= 25; level++) {
      expect(
        contrast(accentForLevel(level), COLORS.pane),
        `level ${level}`,
      ).toBeGreaterThanOrEqual(AA_LARGE)
    }
  })

  it('holds its ends and interpolates between them', () => {
    const first = ACCENT_RAMP[0]
    const last = ACCENT_RAMP[ACCENT_RAMP.length - 1]
    expect(accentForLevel(0)).toBe(first.color)
    expect(accentForLevel(first.level)).toBe(first.color)
    expect(accentForLevel(last.level)).toBe(last.color)
    expect(accentForLevel(last.level + 40)).toBe(last.color)
    // Between two stops it is neither, which is what makes the climb gradual
    // rather than a sequence of jumps.
    const mid = accentForLevel(3)
    expect(mid).not.toBe(ACCENT_RAMP[0].color)
    expect(mid).not.toBe(ACCENT_RAMP[1].color)
  })

  it('visibly changes across the range a long run covers', () => {
    expect(separation(accentForLevel(1), accentForLevel(10))).toBeGreaterThan(
      120,
    )
  })
})

describe('the DOM palette', () => {
  it('reads body text against a card', () => {
    expect(
      contrast(
        BUFFER_OVERFLOW_PALETTE.text!,
        BUFFER_OVERFLOW_PALETTE.surfaceCard!,
      ),
    ).toBeGreaterThanOrEqual(AA)
  })

  it('reads secondary text against a card', () => {
    expect(
      contrast(
        BUFFER_OVERFLOW_PALETTE.textSecondary!,
        BUFFER_OVERFLOW_PALETTE.surfaceCard!,
      ),
    ).toBeGreaterThanOrEqual(AA_LARGE)
  })

  it('reads the primary action label against its fill', () => {
    expect(
      contrast(
        BUFFER_OVERFLOW_PALETTE.actionPrimaryText!,
        BUFFER_OVERFLOW_PALETTE.actionPrimary!,
      ),
    ).toBeGreaterThanOrEqual(AA)
  })

  it('separates the two seat colors', () => {
    expect(
      separation(
        BUFFER_OVERFLOW_PALETTE.teamA!,
        BUFFER_OVERFLOW_PALETTE.teamB!,
      ),
    ).toBeGreaterThan(150)
  })
})

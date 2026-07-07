import { describe, it, expect } from 'vitest'
import {
  drawLabel,
  squarePxFrom,
  PIXELS_PER_MM,
  DEFAULT_TAPE_WIDTH_MM,
  type LabelInput,
} from './labelRenderer'
import { en } from '@src/i18n/en'

/** Minimal 2D-context stub that records the text drawn. */
function stubCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = []
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 0,
    fillRect: () => {},
    strokeRect: () => {},
    fillText: (t: string) => {
      texts.push(t)
    },
  } as unknown as CanvasRenderingContext2D
  return { ctx, texts }
}

const base: LabelInput = {
  reason: 'collision',
  stateId: 'BW',
  score: 42,
  isOverallHigh: false,
  isStateHigh: false,
  highScores: { overall: 0, byState: {} },
}

describe('squarePxFrom', () => {
  const def = Math.round(DEFAULT_TAPE_WIDTH_MM * PIXELS_PER_MM)

  it('uses the tape width when provided', () => {
    expect(squarePxFrom(25)).toBe(Math.round(25 * PIXELS_PER_MM))
    expect(squarePxFrom(50)).toBe(Math.round(50 * PIXELS_PER_MM))
  })

  it('falls back to the default when the width is unknown', () => {
    expect(squarePxFrom(undefined)).toBe(def)
    expect(squarePxFrom(null)).toBe(def)
    expect(squarePxFrom(0)).toBe(def)
  })
})

describe('drawLabel', () => {
  it('draws the score and state', () => {
    const { ctx, texts } = stubCtx()
    drawLabel(ctx, 312, 312, base, en)
    expect(texts).toContain('42')
    expect(texts).toContain('BW')
    expect(texts).toContain(en.states.BW)
  })

  it('shows the high-score badge only when a record was set', () => {
    const banner = en.game.newHighScoreBanner.toUpperCase()

    const none = stubCtx()
    drawLabel(none.ctx, 312, 312, base, en)
    expect(none.texts).not.toContain(banner)

    const high = stubCtx()
    drawLabel(high.ctx, 312, 312, { ...base, isOverallHigh: true }, en)
    expect(high.texts).toContain(banner)
  })
})

import { describe, it, expect } from 'vitest'
import {
  drawLabel,
  squarePxFrom,
  PIXELS_PER_MM,
  DEFAULT_TAPE_WIDTH_MM,
  type LabelInput,
} from './labelRenderer'
import { DEFAULT_LABEL_URL } from '@src/stores/daemonConfig'
import { en } from '@src/i18n/en'

/**
 * Minimal 2D-context stub. Records `fillText` calls; every other method the
 * renderer uses is a no-op — we're checking that the RIGHT strings land at
 * text-drawing time, not that the paint pipeline behaves like a real canvas.
 * Image / gradient / masking calls just need to not throw.
 */
function stubCtx(): { ctx: CanvasRenderingContext2D; texts: string[] } {
  const texts: string[] = []
  const noop = (): void => {}
  const grad = { addColorStop: noop }
  const ctx = {
    fillStyle: '',
    strokeStyle: '',
    font: '',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineWidth: 0,
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    fillRect: noop,
    strokeRect: noop,
    fillText: (t: string) => {
      texts.push(t)
    },
    drawImage: noop,
    measureText: () => ({ width: 100 }),
    createLinearGradient: () => grad,
    beginPath: noop,
    closePath: noop,
    moveTo: noop,
    lineTo: noop,
    quadraticCurveTo: noop,
    fill: noop,
    save: noop,
    restore: noop,
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
  it('draws the score, state name, points caption, and default URL', () => {
    const { ctx, texts } = stubCtx()
    drawLabel(ctx, 312, 312, base, en)
    expect(texts).toContain('42')
    // State name in the header (localized), not the ISO code.
    expect(texts).toContain(en.states.BW)
    // Localised "Points" caption underneath the score.
    expect(texts).toContain(en.game.points)
    // Falls back to the default URL top-right when none is passed.
    expect(texts).toContain(DEFAULT_LABEL_URL)
  })

  it('renders the label URL passed in (from daemon config)', () => {
    const { ctx, texts } = stubCtx()
    drawLabel(ctx, 312, 312, base, en, undefined, 'mzl.la/booth')
    expect(texts).toContain('mzl.la/booth')
    expect(texts).not.toContain(DEFAULT_LABEL_URL)
  })

  it('uses the singular "point" when the score is exactly 1', () => {
    const { ctx, texts } = stubCtx()
    drawLabel(ctx, 312, 312, { ...base, score: 1 }, en)
    expect(texts).toContain(en.game.point)
    expect(texts).not.toContain(en.game.points)
  })

  it('shows the high-score pill only when a record was set', () => {
    const banner = en.game.newHighScoreBanner.toUpperCase()

    const none = stubCtx()
    drawLabel(none.ctx, 312, 312, base, en)
    expect(none.texts).not.toContain(banner)

    const high = stubCtx()
    drawLabel(high.ctx, 312, 312, { ...base, isOverallHigh: true }, en)
    expect(high.texts).toContain(banner)
  })
})

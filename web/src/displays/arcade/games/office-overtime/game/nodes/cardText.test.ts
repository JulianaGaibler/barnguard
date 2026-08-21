import { describe, expect, it, vi } from 'vitest'

// `measureText` needs a real 2D context and reports zero headlessly, which would
// make every string trivially "fit". Stub a proportional model instead, a little
// wider than a typical sans face, so the check errs toward failing.
vi.mock('@src/stargazer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@src/stargazer')>()
  return {
    ...actual,
    measureText: (text: string, style: { font: string }) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1] ?? 10)
      return {
        localW: text.length * size * 0.58,
        localH: size,
        anchorOffsetX: 0,
        anchorOffsetY: 0,
      }
    },
  }
})

const { fitTextBlock } = await import('@src/stargazer')
const { DECK } = await import('../rules/deck')
const { describeAbility, describeScoring } = await import('../rules/text')
const { CARD } = await import('../tuning')

/** A shortlist candidate at 16:9, which is the smallest card drawn in detail. */
const W = 200
const H = W * 1.4
const mkFont = (size: number) => `400 ${size.toFixed(1)}px sans-serif`
const sizes = CARD.bodySizeFracs.map((f) => f * W)

const textX = W * CARD.ribbonWidthFrac + W * 0.04
const bodyWidth = W - textX - W * 0.05

const abilityBand = {
  width: bodyWidth,
  height: H * (CARD.abilityBottomFrac - CARD.abilityTopFrac),
}

// The review shares its band with the points seal, so it is the tighter box.
const scrollHeight = H * (CARD.reviewBottomFrac - CARD.reviewTopFrac)
const sealR = Math.min(scrollHeight * 0.28, W * 0.1)
const reviewBand = {
  width: bodyWidth + W * 0.02 - (sealR * 0.6 + sealR * 1.35),
  height: scrollHeight * 0.86,
}

describe('card rules text fits its band', () => {
  it.each(DECK.map((c) => [c.name, c.id] as const))(
    '%s shows its ability in full',
    (_name, id) => {
      const card = DECK.find((c) => c.id === id)!
      const text = describeAbility(card)
      if (!text) return
      const block = fitTextBlock(text, sizes, mkFont, abilityBand)
      expect(block.truncated, text).toBe(false)
    },
  )

  it.each(DECK.map((c) => [c.name, c.id] as const))(
    '%s shows its review in full',
    (_name, id) => {
      const card = DECK.find((c) => c.id === id)!
      const text = describeScoring(card)
      const block = fitTextBlock(text, sizes, mkFont, reviewBand)
      expect(block.truncated, text).toBe(false)
    },
  )

  it('reports the longest strings, so a verbose card is easy to spot', () => {
    const longest = (f: (c: (typeof DECK)[number]) => string) =>
      DECK.map(f).sort((a, b) => b.length - a.length)[0]!
    const ability = longest(describeAbility)
    const review = longest(describeScoring)
    expect(ability.length).toBeLessThan(160)
    expect(review.length).toBeLessThan(120)
  })
})

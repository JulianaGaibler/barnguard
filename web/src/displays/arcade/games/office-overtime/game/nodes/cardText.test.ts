import { describe, expect, it, vi } from 'vitest'

// `measureText` needs a real 2D context and reports zero headlessly, which would
// make every string trivially "fit". Stub a proportional model on textLayout's
// own dependency (not the barrel, which it does not import measurement through),
// a little wider than a typical sans face so the check errs toward failing.
vi.mock('@src/stargazer/render/gfx/rasterizeLabel', async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import('@src/stargazer/render/gfx/rasterizeLabel')
    >()
  return {
    ...actual,
    measureText: (text: string, style: { font: string }) => {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1] ?? 10)
      return {
        localW: text.length * size * 0.55,
        localH: size,
        anchorOffsetX: 0,
        anchorOffsetY: 0,
      }
    },
  }
})

const { fitRichTextBlock } = await import('@src/stargazer')
const { DECK } = await import('../rules/deck')
const { describeAbilitySpans, describeScoringSpans } =
  await import('../rules/text')
const { cardFace, BODY_SIZE_FRACS } = await import('../cardFace')

// A shortlist candidate at the reference aspect: the smallest card drawn in full.
const W = 200
const H = Math.round(W * (388 / 256))
const g = cardFace(W, H)
const sizes = BODY_SIZE_FRACS.map((f) => f * W)
const mkFont = (size: number, bold: boolean): string =>
  `${bold ? 700 : 500} ${size.toFixed(1)}px sans-serif`

describe('card text fits its band', () => {
  it('actually measures, so the stub is doing its job', () => {
    const block = fitRichTextBlock(
      [{ text: 'this is a very long sentence that cannot possibly fit' }],
      [8],
      () => '8px sans-serif',
      { width: 20, height: 10 },
    )
    expect(block.truncated).toBe(true)
  })

  it.each(DECK.map((c) => [c.name, c.id] as const))(
    '%s shows its on-hire text in full',
    (_name, id) => {
      const card = DECK.find((c) => c.id === id)!
      const spans = describeAbilitySpans(card)
      if (spans.length === 0) return
      const block = fitRichTextBlock(spans, sizes, mkFont, g.onHire)
      expect(block.truncated).toBe(false)
    },
  )

  it.each(DECK.map((c) => [c.name, c.id] as const))(
    '%s shows its review in full',
    (_name, id) => {
      const card = DECK.find((c) => c.id === id)!
      const block = fitRichTextBlock(
        describeScoringSpans(card),
        sizes,
        mkFont,
        g.reviewText,
      )
      expect(block.truncated).toBe(false)
    },
  )
})

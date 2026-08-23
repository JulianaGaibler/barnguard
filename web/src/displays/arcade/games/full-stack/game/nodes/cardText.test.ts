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
      const ink = text.length * size * 0.55
      return {
        localW: ink + 4,
        localH: size + 4,
        advance: ink,
        anchorOffsetX: 0,
        anchorOffsetY: 0,
      }
    },
  }
})

const { fitRichTextBlock, fitTextBlock, richText } =
  await import('@src/stargazer')
const { DECK } = await import('../rules/deck')
const { describeAbilitySpans, describeScoringSpans } =
  await import('../rules/text')
const { abilityFaceSpans, scoringFaceSpans } =
  await import('../rules/glyphText')
const { cardFace, BODY_SIZE_FRACS, NAME_SIZE_FRACS } =
  await import('../cardFace')
type TextSpan = import('@src/stargazer').TextSpan

// A shortlist candidate at the reference aspect: the smallest card drawn in full.
const W = 200
const H = Math.round(W * (388 / 256))
const g = cardFace(W, H)
const sizes = BODY_SIZE_FRACS.map((f) => f * W)
// The leading the card draws with. A glyph makes its line exactly as tall as
// itself, so fitting without this passes blocks the card cannot draw.
const LEADING = 1.15
const mkFont = (size: number, bold: boolean): string =>
  `${bold ? 700 : 500} ${size.toFixed(1)}px sans-serif`

describe('card text in prose fits its band', () => {
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
      const block = fitRichTextBlock(spans, sizes, mkFont, g.onHire, LEADING)
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
        LEADING,
      )
      expect(block.truncated).toBe(false)
    },
  )
})

// The size ladder bottoms out at 0.036w, which is 7.2px at this width. A block
// that lands there is inside its band and unreadable on a card, so a glyph that
// costs the block that much has taken more than it gave. The floor sits one
// rung above the bottom, since the densest card in the deck already reaches the
// rung below that in prose.
const LEGIBLE_MIN = 0.044 * W

describe('card text in symbols fits its band', () => {
  const bands = [
    ['on-hire', g.onHire, abilityFaceSpans, sizes],
    ['review', g.reviewText, scoringFaceSpans, sizes],
  ] as const

  for (const [band, box, spansOf, ladder] of bands) {
    it.each(DECK.map((c) => [c.name, c.id] as const))(
      `%s shows its ${band} symbols in full`,
      (_name, id) => {
        const card = DECK.find((c) => c.id === id)!
        const spans = spansOf(card)
        if (spans.length === 0) return
        const block = fitRichTextBlock(spans, ladder, mkFont, box, LEADING)
        expect(block.truncated).toBe(false)
        // A word wider than the band goes down unsplit and is not reported as
        // truncated, and a value welded to a glyph is now long enough to be
        // that word.
        for (const line of block.lines) {
          expect(line.width).toBeLessThanOrEqual(box.width + 1e-6)
        }
        expect(block.size).toBeGreaterThanOrEqual(LEGIBLE_MIN)
      },
    )
  }

  // The payout in parentheses is the widest thing the on-hire band takes that
  // is not on the card, so the band has to hold the largest one the rules can
  // produce, not the one the deck happens to show first.
  it.each(DECK.map((c) => [c.name, c.id] as const))(
    '%s still fits its on-hire band at the largest payout',
    (_name, id) => {
      const card = DECK.find((c) => c.id === id)!
      const pays = card.ability.map((e) =>
        e.effect === 'gainPer' ? 9 * e.amount : null,
      )
      const spans = abilityFaceSpans(card, pays)
      if (spans.length === 0) return
      const block = fitRichTextBlock(spans, sizes, mkFont, g.onHire, LEADING)
      expect(block.truncated).toBe(false)
      for (const line of block.lines) {
        expect(line.width).toBeLessThanOrEqual(g.onHire.width + 1e-6)
      }
      expect(block.size).toBeGreaterThanOrEqual(LEGIBLE_MIN)
    },
  )

  // A glyph carries what it says, so a line of symbols still has a reading for
  // a log or a screen reader. These are the two joins that used to run together
  // into "1kbudget" and "approvalsapprovals".
  it('reads a money figure and a run of slips back as words', () => {
    const paid = DECK.find((c) => c.id === 'mgmt-chief-operating-officer')!
    expect(richText(abilityFaceSpans(paid, [3]))).toBe(
      '1k budget per Leadership (3k)',
    )
    const slips = DECK.find((c) => c.id === 'mgmt-board-member')!
    expect(richText(abilityFaceSpans(slips))).toBe('2 approvals')
  })

  it('keeps a sentence readable back out of the spans', () => {
    const card = DECK.find((c) => c.id === 'mgmt-head-of-product-strategy')!
    expect(richText(scoringFaceSpans(card))).toBe(
      'per Leadership in this column',
    )
  })
})

describe('symbol coverage', () => {
  const hasGlyph = (spans: TextSpan[]): boolean => spans.some((s) => 'box' in s)

  // Every resource has a symbol and every card either pays one or is priced in
  // one, so a card with nothing but words on it means a clause fell back that
  // did not have to.
  it('leaves no card speaking only in words', () => {
    const prose = DECK.filter(
      (c) =>
        !hasGlyph(abilityFaceSpans(c) as TextSpan[]) &&
        !hasGlyph(scoringFaceSpans(c) as TextSpan[]),
    )
    expect(prose.map((c) => c.name)).toEqual([])
  })

  it('draws the common cases as symbols', () => {
    const iconised = DECK.filter((c) =>
      hasGlyph(scoringFaceSpans(c) as TextSpan[]),
    )
    expect(iconised.length).toBeGreaterThanOrEqual(65)
  })
})

describe('card names', () => {
  // Job titles run long, and a cut one is unreadable, so every name in the deck
  // has to land inside the two-line box at one of the offered sizes.
  // The face-down card puts a fixed phrase where a name goes, and it has to
  // survive the same box every job title does.
  it('fits the face-down label in the name box', () => {
    const block = fitTextBlock(
      'Replaced by AI',
      NAME_SIZE_FRACS.map((f) => f * W),
      (size) => `700 ${size.toFixed(1)}px sans-serif`,
      g.nameBox,
      0.95,
    )
    expect(block.truncated).toBe(false)
  })

  it('fits every job title in the name box without cutting it', () => {
    const nameSizes = NAME_SIZE_FRACS.map((f) => f * W)
    const cut: string[] = []
    for (const card of DECK) {
      const block = fitTextBlock(
        card.name,
        nameSizes,
        (size) => `700 ${size.toFixed(1)}px sans-serif`,
        g.nameBox,
        0.95,
      )
      if (block.truncated) cut.push(card.name)
    }
    expect(cut).toEqual([])
  })
})

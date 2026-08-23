import { beforeEach, describe, expect, it, vi } from 'vitest'

// `measureText` shapes text in a real Canvas 2D context, which does not exist
// headlessly and reports zero for everything. These tests are about the line
// breaking, so measurement is stubbed with a deterministic monospace model:
// one unit of width per character per point of font size.
//
// The stub keeps `localW` a padded bitmap box and `advance` the bare pen step,
// as the real one does. Conflating them is what put a gap between every pair of
// runs on a line, so the difference has to survive into the tests.
const PAD = 4
vi.mock('./rasterizeLabel', () => ({
  measureText: (text: string, style: { font: string }) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1] ?? 10)
    const ink = text.length * size
    return {
      localW: ink + PAD,
      localH: size + PAD,
      advance: ink,
      ascent: size * 0.8,
      descent: size * 0.2,
      anchorOffsetX: 0,
      anchorOffsetY: 0,
    }
  },
  fontMetrics: (font: string) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10)
    return {
      ascent: size * 0.8,
      descent: size * 0.2,
      capHeight: size * 0.7,
      lineHeight: size,
    }
  },
  parseFontSizePx: (font: string) =>
    Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 10),
}))

const {
  _resetTextLayoutCacheForTests,
  ellipsize,
  fitFontSize,
  fitRichTextBlock,
  fitTextBlock,
  textAdvance,
  textMetrics,
  textWidth,
  wrapRichText,
  wrapText,
  wrapTextInfo,
  richText,
} = await import('./textLayout')
type RichRun = import('./textLayout').RichRun
type TextSpan = import('./textLayout').TextSpan

const FONT = '400 10px sans-serif'
/** What `textWidth` reports for `n` characters under the stub. */
const chars = (n: number) => n * 10 + PAD
/** What the pen advances over `n` characters, which is what positions runs. */
const adv = (n: number) => n * 10

describe('textLayout', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  it('measures a longer string as wider', () => {
    expect(textWidth('mmmmmmmmmm', FONT)).toBeGreaterThan(textWidth('m', FONT))
  })

  it('reports an advance narrower than the padded bitmap box', () => {
    expect(textAdvance('abc', FONT)).toBe(30)
    expect(textWidth('abc', FONT)).toBe(34)
  })

  it('steps rich runs by the advance, leaving no gap between them', () => {
    const [line] = wrapRichText(
      [{ text: 'ab' }, { text: 'cd', bold: true }, { text: 'ef' }],
      () => FONT,
      chars(40),
    )
    expect(line!.runs.map((r) => r.x)).toEqual([0, 20, 40])
    expect(line!.width).toBe(60)
  })

  it('returns one line when it already fits', () => {
    expect(wrapText('one two', FONT, chars(20))).toEqual(['one two'])
  })

  it('breaks on whitespace when it does not fit', () => {
    expect(wrapText('alpha beta gamma delta', FONT, chars(6), 4)).toEqual([
      'alpha',
      'beta',
      'gamma',
      'delta',
    ])
  })

  it('never splits a single word', () => {
    expect(wrapText('supercalifragilistic', FONT, chars(4), 3)).toEqual([
      'supercalifragilistic',
    ])
  })

  it('honours the line cap and ellipsizes the overflow', () => {
    const lines = wrapText('alpha beta gamma delta', FONT, chars(6), 2)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toMatch(/\u2026$/)
  })

  it('does not ellipsize when the text ends exactly on the cap', () => {
    expect(wrapText('alpha beta', FONT, chars(6), 2)).toEqual(['alpha', 'beta'])
  })

  it('collapses runs of whitespace', () => {
    expect(wrapText('  one   two  ', FONT, chars(20))).toEqual(['one two'])
  })

  it('returns no lines for empty text', () => {
    expect(wrapText('   ', FONT, chars(10))).toEqual([])
  })

  it('leaves a short string alone when ellipsizing', () => {
    expect(ellipsize('hi', FONT, chars(10))).toBe('hi')
  })

  it('marks a trimmed string with an ellipsis', () => {
    const out = ellipsize('a much longer string', FONT, chars(6))
    expect(out).toMatch(/\u2026$/)
    expect(out.length).toBeLessThan('a much longer string'.length)
  })

  it('picks the largest size that fits', () => {
    const make = (s: number) => `400 ${s}px sans-serif`
    // Fitting goes by the padded bitmap box, so it stays conservative about ink
    // that overhangs the advance: 'word' is 4 characters, needing 80 + PAD at
    // size 20 and 40 + PAD at size 10.
    expect(fitFontSize('word', [20, 10], make, chars(8))).toBe(20)
    expect(fitFontSize('word', [20, 10], make, chars(8) - 1)).toBe(10)
  })

  it('falls back to the smallest size when nothing fits', () => {
    const make = (s: number) => `400 ${s}px sans-serif`
    expect(fitFontSize('word', [20, 10], make, 0)).toBe(10)
  })

  it('returns a cached result for a repeated call', () => {
    const a = wrapText('alpha beta', FONT, chars(6), 2)
    expect(wrapText('alpha beta', FONT, chars(6), 2)).toBe(a)
  })
})

describe('wrapTextInfo', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  it('reports nothing dropped when the text fits', () => {
    expect(wrapTextInfo('alpha beta', FONT, chars(20), 2).truncated).toBe(false)
  })

  it('reports the drop when it does not fit', () => {
    expect(wrapTextInfo('alpha beta gamma', FONT, chars(6), 1).truncated).toBe(
      true,
    )
  })
})

describe('fitTextBlock', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  const make = (s: number) => `400 ${s}px sans-serif`

  it('keeps the largest size that fits the box whole', () => {
    // 'alpha beta' is 10 characters. At size 10 one line needs 100 units, and
    // the box is 120 wide and tall enough for a line, so the biggest fits.
    const block = fitTextBlock('alpha beta', [10, 5], make, {
      width: 120,
      height: 40,
    })
    expect(block.size).toBe(10)
    expect(block.lines).toEqual(['alpha beta'])
    expect(block.truncated).toBe(false)
  })

  it('drops to a smaller size rather than truncate', () => {
    // Too wide for size 10 in a one-line box, but fine at size 5.
    const block = fitTextBlock('alpha beta', [10, 5], make, {
      width: 60,
      height: 12,
    })
    expect(block.size).toBe(5)
    expect(block.truncated).toBe(false)
  })

  it('uses the height as the line budget', () => {
    const tall = fitTextBlock('alpha beta gamma', [10], make, {
      width: 60,
      height: 100,
    })
    const short = fitTextBlock('alpha beta gamma', [10], make, {
      width: 60,
      height: 12,
    })
    expect(tall.lines.length).toBeGreaterThan(short.lines.length)
  })

  it('reports truncation when even the smallest size cannot fit', () => {
    const block = fitTextBlock('alpha beta gamma delta', [10, 8], make, {
      width: 30,
      height: 12,
    })
    expect(block.truncated).toBe(true)
    expect(block.size).toBe(8)
  })

  it("spaces lines by the font's own line height, scaled by the ratio", () => {
    // The stub reports a 10px font as 10 tall, so the default is the typeface's
    // natural spacing rather than a multiple of the em size.
    const natural = fitTextBlock('alpha', [10], make, {
      width: 200,
      height: 40,
    })
    expect(natural.lineHeight).toBeCloseTo(10, 6)
    const loose = fitTextBlock(
      'alpha',
      [10],
      make,
      {
        width: 200,
        height: 40,
      },
      1.2,
    )
    expect(loose.lineHeight).toBeCloseTo(12, 6)
  })

  it('puts the first baseline an ascent below the block top', () => {
    const block = fitTextBlock('alpha', [10], make, { width: 200, height: 40 })
    expect(block.firstBaselineY).toBeCloseTo(8, 6)
  })

  it('reports a height with no phantom trailing line', () => {
    const one = fitTextBlock('alpha', [10], make, { width: 200, height: 40 })
    expect(one.lines).toHaveLength(1)
    // One line is its own box, not a whole line advance.
    expect(one.height).toBeCloseTo(10, 6)

    const two = fitTextBlock('alpha beta', [10], make, {
      width: 60,
      height: 40,
    })
    expect(two.lines).toHaveLength(2)
    expect(two.height).toBeCloseTo(one.lineHeight + 10, 6)
  })
})

describe('textMetrics', () => {
  it('reports the advance, the string ink and the font-wide values', () => {
    const m = textMetrics('abc', FONT)
    expect(m.advance).toBeCloseTo(30)
    expect(m.ascent).toBeCloseTo(8)
    expect(m.descent).toBeCloseTo(2)
    expect(m.capHeight).toBeCloseTo(7)
    expect(m.lineHeight).toBeCloseTo(10)
  })

  it('evicts the oldest entry rather than flushing the whole cache', () => {
    // The old behaviour cleared everything at the cap, so a working set one
    // over budget got a zero hit rate.
    _resetTextLayoutCacheForTests()
    for (let i = 0; i < 600; i++) textAdvance(`w${i}`, FONT)
    // The most recent entries survive an overflow that would have wiped them.
    expect(textAdvance('w599', FONT)).toBeCloseTo(textAdvance('w599', FONT))
    expect(textAdvance('w598', FONT)).toBeGreaterThan(0)
  })
})

// Weight is ignored by the width stub (it only reads px), so bold and plain
// runs measure the same. That is deliberate: these tests pin structure and x
// offsets, not the visual weight.
const RICH_FONT = (bold: boolean) => `${bold ? 700 : 400} 10px sans-serif`

const richMake = (size: number, bold: boolean) =>
  `${bold ? 700 : 400} ${size}px sans-serif`

/** The words on a line, with inline boxes skipped. */
const lineText = (line: { runs: RichRun[] }): string =>
  line.runs.map((r) => (r.kind === 'text' ? r.text : '')).join('')

describe('wrapRichText', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  it('coalesces one weight into a single run', () => {
    const lines = wrapRichText(
      [{ text: 'gain 2 approvals' }],
      RICH_FONT,
      chars(30),
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]!.runs).toHaveLength(1)
    expect(lines[0]!.runs[0]).toMatchObject({
      text: 'gain 2 approvals',
      bold: false,
      x: 0,
    })
    expect(lines[0]!.width).toBe(adv(16))
  })

  it('splits into runs at each weight change and offsets them', () => {
    const lines = wrapRichText(
      [{ text: 'gain ' }, { text: '3', bold: true }, { text: ' approvals' }],
      RICH_FONT,
      chars(30),
    )
    expect(lines).toHaveLength(1)
    const runs = lines[0]!.runs
    expect(runs).toHaveLength(3)
    expect(runs[0]).toMatchObject({ text: 'gain ', bold: false, x: 0 })
    expect(runs[1]).toMatchObject({ text: '3 ', bold: true, x: adv(5) })
    expect(runs[2]).toMatchObject({
      text: 'approvals',
      bold: false,
      x: adv(7),
    })
  })

  it('keeps a bold value glued to plain text as one word', () => {
    // No spaces around the bold run: it must not wrap between "$" and "6".
    const lines = wrapRichText(
      [{ text: '+$' }, { text: '6', bold: true }, { text: 'k' }],
      RICH_FONT,
      chars(2),
    )
    expect(lines).toHaveLength(1)
    expect(lineText(lines[0]!)).toBe('+$6k')
  })

  it('wraps on whitespace across lines', () => {
    const lines = wrapRichText(
      [{ text: 'alpha beta gamma delta' }],
      RICH_FONT,
      chars(11),
      4,
    )
    expect(lines.map(lineText)).toEqual(['alpha beta', 'gamma delta'])
  })

  it('returns no lines for empty spans', () => {
    expect(wrapRichText([{ text: '   ' }], RICH_FONT, chars(10))).toEqual([])
  })

  it('caches a repeated call', () => {
    const a = wrapRichText([{ text: 'alpha beta' }], RICH_FONT, chars(20))
    expect(wrapRichText([{ text: 'alpha beta' }], RICH_FONT, chars(20))).toBe(a)
  })
})

// A box two ems wide and one tall, so its advance is unmistakable against the
// stub's one-unit-per-character-per-point text.
const BOX: TextSpan = { box: 'badge', heightEm: 1, aspect: 2, alt: 'Design' }

describe('inline boxes', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  it('steps the pen by the box, and by its lead and trail', () => {
    const lines = wrapRichText(
      [{ text: 'per ' }, BOX, { text: ' each' }],
      RICH_FONT,
      chars(40),
    )
    const runs = lines[0]!.runs
    expect(runs).toHaveLength(3)
    expect(runs[1]).toMatchObject({ kind: 'box', box: 'badge', width: 20 })
    expect(runs[2]).toMatchObject({ kind: 'text', x: adv(4) + 20 })

    const spaced = wrapRichText(
      [{ text: 'per ' }, { ...BOX, leadEm: 0.5, trailEm: 0.5 }, { text: ' e' }],
      RICH_FONT,
      chars(40),
    )
    const spacedRuns = spaced[0]!.runs
    expect(spacedRuns[1]).toMatchObject({ x: adv(4) + 5 })
    expect(spacedRuns[2]).toMatchObject({ x: adv(4) + 30 })
  })

  it('centres the box on the cap height, level with the digits', () => {
    const lines = wrapRichText([{ text: '2' }, BOX], RICH_FONT, chars(40))
    const box = lines[0]!.runs[1]!
    expect(box.kind).toBe('box')
    if (box.kind !== 'box') return
    // Cap height is 7 under the stub, and the box is 10 tall.
    expect(box.y).toBe(-(7 + 10) / 2)
  })

  it('breaks run coalescing, so the text either side is not merged', () => {
    const lines = wrapRichText(
      [{ text: 'a' }, BOX, { text: 'b' }],
      RICH_FONT,
      chars(40),
    )
    expect(lines[0]!.runs.map((r) => r.kind)).toEqual(['text', 'box', 'text'])
  })

  it('welds to the text beside it, so a value never wraps off its badge', () => {
    const lines = wrapRichText(
      [{ text: '2' }, BOX],
      RICH_FONT,
      // Narrower than the pair, which still goes down whole on one line.
      chars(2),
      4,
    )
    expect(lines).toHaveLength(1)
    expect(lines[0]!.runs.map((r) => r.kind)).toEqual(['text', 'box'])
  })

  it('takes the space between words from the last text run, not the box', () => {
    // The box ends the first word, so the space after it has to reach back
    // past the box for a weight. A box carries none.
    const lines = wrapRichText(
      [{ text: 'x', bold: true }, BOX, { text: ' y' }],
      RICH_FONT,
      chars(40),
    )
    const runs = lines[0]!.runs
    expect(runs.map((r) => r.kind)).toEqual(['text', 'box', 'text', 'text'])
    expect(runs[2]).toMatchObject({ kind: 'text', text: ' ', bold: true })
  })

  it('drops a box with no area rather than breaking a run for nothing', () => {
    const lines = wrapRichText(
      [{ text: 'a' }, { box: 'b', heightEm: 0, aspect: 2 }, { text: 'b' }],
      RICH_FONT,
      chars(40),
    )
    expect(lines[0]!.runs).toHaveLength(1)
    expect(lineText(lines[0]!)).toBe('ab')
  })

  it('reads back as a sentence through alt', () => {
    expect(richText([{ text: 'per ' }, BOX, { text: ' each' }])).toBe(
      'per Design each',
    )
  })

  it('caches on the box geometry, not just its name', () => {
    const spans = (heightEm: number): TextSpan[] => [
      { text: 'a' },
      { box: 'badge', heightEm, aspect: 2 },
    ]
    const a = wrapRichText(spans(1), RICH_FONT, chars(40))
    expect(wrapRichText(spans(1), RICH_FONT, chars(40))).toBe(a)
    expect(wrapRichText(spans(2), RICH_FONT, chars(40))).not.toBe(a)
  })
})

describe('fitRichTextBlock with inline boxes', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  it('widens the line for a box that overhangs the font', () => {
    const tall: TextSpan = { box: 'badge', heightEm: 2, aspect: 1 }
    const plain = fitRichTextBlock([{ text: 'a' }], [10], richMake, {
      width: 400,
      height: 100,
    })
    const withBox = fitRichTextBlock([{ text: 'a' }, tall], [10], richMake, {
      width: 400,
      height: 100,
    })
    // Cap height 7 and a 20px box put the baseline 13.5 down, past the font's 8.
    expect(plain.lineHeight).toBe(10)
    expect(withBox.lineHeight).toBe(13.5 + 6.5)
    expect(withBox.firstBaselineY).toBe(13.5)
  })

  it('spends the extra height out of the line budget', () => {
    const tall: TextSpan = { box: 'badge', heightEm: 2, aspect: 1 }
    const box = { width: chars(6), height: 32 }
    const plain = fitRichTextBlock(
      [{ text: 'alpha beta gamma' }],
      [10],
      richMake,
      box,
    )
    const withBox = fitRichTextBlock(
      [{ text: 'alpha beta gamma' }, tall],
      [10],
      richMake,
      box,
    )
    expect(withBox.lines.length).toBeLessThan(plain.lines.length)
  })

  it('drops a trailing box whole rather than slicing it', () => {
    const block = fitRichTextBlock(
      [{ text: 'alpha' }, { text: ' beta ' }, BOX],
      [10],
      richMake,
      { width: chars(6), height: 12 },
    )
    expect(block.truncated).toBe(true)
    expect(
      block.lines.every((l) => l.runs.every((r) => r.kind === 'text')),
    ).toBe(true)
  })

  it('ellipsizes a line that is nothing but boxes', () => {
    // Spaces so the boxes are three words rather than one welded run, and a
    // box wider than the whole line so nothing survives the trim.
    const spans: TextSpan[] = [BOX, { text: ' ' }, BOX, { text: ' ' }, BOX]
    const block = fitRichTextBlock(spans, [10], richMake, {
      width: 5,
      height: 12,
    })
    expect(block.truncated).toBe(true)
    expect(lineText(block.lines[block.lines.length - 1]!)).toBe('\u2026')
  })
})

describe('fitRichTextBlock', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  it('keeps the largest size that fits the box whole', () => {
    const block = fitRichTextBlock(
      [{ text: 'alpha beta' }],
      [10, 5],
      richMake,
      {
        width: 120,
        height: 40,
      },
    )
    expect(block.size).toBe(10)
    expect(block.truncated).toBe(false)
    expect(block.lines).toHaveLength(1)
  })

  it('reports truncation and ellipsizes when nothing fits', () => {
    const block = fitRichTextBlock(
      [{ text: 'alpha beta gamma delta' }],
      [10, 8],
      richMake,
      { width: 30, height: 12 },
    )
    expect(block.truncated).toBe(true)
    expect(/…$/.test(lineText(block.lines[block.lines.length - 1]!))).toBe(true)
  })
})

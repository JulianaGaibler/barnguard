import { beforeEach, describe, expect, it, vi } from 'vitest'

// `measureText` shapes text in a real Canvas 2D context, which does not exist
// headlessly and reports zero for everything. These tests are about the line
// breaking, so measurement is stubbed with a deterministic monospace model:
// one unit of width per character per point of font size.
vi.mock('./rasterizeLabel', () => ({
  measureText: (text: string, style: { font: string }) => {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(style.font)?.[1] ?? 10)
    return {
      localW: text.length * size,
      localH: size,
      anchorOffsetX: 0,
      anchorOffsetY: 0,
    }
  },
}))

const {
  _resetTextLayoutCacheForTests,
  ellipsize,
  fitFontSize,
  fitRichTextBlock,
  fitTextBlock,
  textWidth,
  wrapRichText,
  wrapText,
  wrapTextInfo,
} = await import('./textLayout')

const FONT = '400 10px sans-serif'
/** Width of `n` characters under the stub. */
const chars = (n: number) => n * 10

describe('textLayout', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  it('measures a longer string as wider', () => {
    expect(textWidth('mmmmmmmmmm', FONT)).toBeGreaterThan(textWidth('m', FONT))
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
    // 'word' is 4 characters, so size 20 needs 80 units and size 10 needs 40.
    expect(fitFontSize('word', [20, 10], make, 80)).toBe(20)
    expect(fitFontSize('word', [20, 10], make, 79)).toBe(10)
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

  it('spaces lines by the ratio', () => {
    const block = fitTextBlock('alpha', [10], make, { width: 200, height: 40 })
    expect(block.lineHeight).toBeCloseTo(12, 6)
  })
})

// Weight is ignored by the width stub (it only reads px), so bold and plain
// runs measure the same. That is deliberate: these tests pin structure and x
// offsets, not the visual weight.
const RICH_FONT = (bold: boolean) => `${bold ? 700 : 400} 10px sans-serif`

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
    expect(lines[0]!.width).toBe(chars(16))
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
    expect(runs[1]).toMatchObject({ text: '3 ', bold: true, x: chars(5) })
    expect(runs[2]).toMatchObject({
      text: 'approvals',
      bold: false,
      x: chars(7),
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
    expect(lines[0]!.runs.map((r) => r.text).join('')).toBe('+$6k')
  })

  it('wraps on whitespace across lines', () => {
    const lines = wrapRichText(
      [{ text: 'alpha beta gamma delta' }],
      RICH_FONT,
      chars(11),
      4,
    )
    expect(lines.map((l) => l.runs.map((r) => r.text).join(''))).toEqual([
      'alpha beta',
      'gamma delta',
    ])
  })

  it('returns no lines for empty spans', () => {
    expect(wrapRichText([{ text: '   ' }], RICH_FONT, chars(10))).toEqual([])
  })

  it('caches a repeated call', () => {
    const a = wrapRichText([{ text: 'alpha beta' }], RICH_FONT, chars(20))
    expect(wrapRichText([{ text: 'alpha beta' }], RICH_FONT, chars(20))).toBe(a)
  })
})

describe('fitRichTextBlock', () => {
  beforeEach(() => _resetTextLayoutCacheForTests())

  const richMake = (size: number, bold: boolean) =>
    `${bold ? 700 : 400} ${size}px sans-serif`

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
    expect(
      block.lines[block.lines.length - 1]!.runs.some((r) => /…$/.test(r.text)),
    ).toBe(true)
  })
})

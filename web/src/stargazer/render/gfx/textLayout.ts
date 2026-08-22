// Text measuring helpers built on `measureText`.
//
// Label rendering is single-line by contract: `fillText` bakes one string into
// one cached bitmap, and there is no rect clip to fall back on, only a bitmap
// mask. Anything that has to sit inside a fixed box therefore has to be broken
// into lines and truncated before it is drawn, which is what these do.
//
// Measuring shapes the string in Canvas 2D, so it is not free. Results are
// memoized on text, font and width, which keeps a static label off the
// per-frame path entirely.

import { measureText } from './rasterizeLabel'

const cache = new Map<string, { lines: string[]; truncated: boolean }>()
const richCache = new Map<string, { lines: RichLine[]; truncated: boolean }>()
/** Bounded so a long-running scene cannot grow the cache without limit. */
const CACHE_MAX = 512
const ELLIPSIS = '\u2026'

/**
 * Width of one line, in the same local units `fillText` draws in.
 *
 * ```ts
 * const w = textWidth('Design Systems Lead', '600 24px Inter, sans-serif')
 * ```
 */
export function textWidth(text: string, font: string): number {
  return measureText(text, {
    font,
    align: 'left',
    baseline: 'alphabetic',
    color: '#000',
  }).localW
}

/**
 * Trim `text` until it fits `maxWidth`, leaving a trailing ellipsis.
 *
 * Returns the text unchanged when it already fits.
 */
export function ellipsize(
  text: string,
  font: string,
  maxWidth: number,
): string {
  if (textWidth(text, font) <= maxWidth) return text
  let cut = text
  while (cut.length > 1 && textWidth(cut + ELLIPSIS, font) > maxWidth) {
    cut = cut.slice(0, -1)
  }
  return cut.trimEnd() + ELLIPSIS
}

/**
 * Break `text` into at most `maxLines` lines that each fit `maxWidth`.
 *
 * ```ts
 * const lines = wrapText(card.rules, font, box.width - 16, 3)
 * lines.forEach((line, i) =>
 *   gfx.fillText(line, x, y + i * lineHeight, style),
 * )
 * ```
 *
 * Breaks on whitespace only. A single word wider than `maxWidth` is left
 * overlong rather than split mid-word, so a long identifier stays readable. If
 * the text needs more lines than allowed, the last one is ellipsized.
 */
export function wrapText(
  text: string,
  font: string,
  maxWidth: number,
  maxLines = 3,
): string[] {
  return wrapTextInfo(text, font, maxWidth, maxLines).lines
}

/** {@link wrapText}, plus whether the text had to be cut to fit `maxLines`. */
export function wrapTextInfo(
  text: string,
  font: string,
  maxWidth: number,
  maxLines = 3,
): { lines: string[]; truncated: boolean } {
  const key = font + ' ' + maxWidth.toFixed(1) + ' ' + maxLines + ' ' + text
  const hit = cache.get(key)
  if (hit) return { lines: hit.lines, truncated: hit.truncated }

  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  let used = 0
  for (const word of words) {
    const candidate = line ? line + ' ' + word : word
    if (line && textWidth(candidate, font) > maxWidth) {
      lines.push(line)
      line = word
      if (lines.length === maxLines) break
    } else {
      line = candidate
    }
    used++
  }
  if (lines.length < maxLines && line) {
    lines.push(line)
    used = words.length
  }
  // Words were dropped, so mark the last line even if it fits on its own.
  // Appending first, then trimming, keeps the result inside `maxWidth`.
  if (lines.length === maxLines && used < words.length) {
    lines[maxLines - 1] = ellipsize(
      lines[maxLines - 1]! + ELLIPSIS,
      font,
      maxWidth,
    )
  }

  const truncated = used < words.length
  if (cache.size >= CACHE_MAX) cache.clear()
  cache.set(key, { lines, truncated })
  return { lines, truncated }
}

/**
 * Largest size in `sizes` whose rendering of `text` fits `maxWidth`.
 *
 * Pass `sizes` largest first. Falls back to the last entry when nothing fits,
 * so pair it with {@link ellipsize} if the text must not overflow.
 *
 * ```ts
 * const size = fitFontSize(
 *   name,
 *   [28, 24, 20, 16],
 *   (s) => `600 ${s}px Inter`,
 *   w,
 * )
 * ```
 */
export function fitFontSize(
  text: string,
  sizes: readonly number[],
  makeFont: (size: number) => string,
  maxWidth: number,
): number {
  for (const size of sizes) {
    if (textWidth(text, makeFont(size)) <= maxWidth) return size
  }
  return sizes[sizes.length - 1] ?? 12
}

/** Clear the memo. Tests only. */
export function _resetTextLayoutCacheForTests(): void {
  cache.clear()
  richCache.clear()
}

/** A block of text laid out to fit a box. */
export interface TextBlock {
  lines: string[]
  /** The size from `sizes` that was used. */
  size: number
  /** Baseline-to-baseline spacing for `lines`. */
  lineHeight: number
  /** True when even the smallest size had to drop words. */
  truncated: boolean
}

/**
 * Lay `text` out at the largest size from `sizes` that fits `box` whole.
 *
 * Pass `sizes` largest first. Each is tried in turn: the line budget comes from
 * the box height at that size, and a size is accepted only if the text wraps
 * within it without losing words. Falls back to the smallest size, truncated,
 * when nothing fits.
 *
 * ```ts
 * const block = fitTextBlock(card.rules, [16, 14, 12, 10], mkFont, box)
 * block.lines.forEach((line, i) =>
 *   gfx.fillText(line, box.x, y + i * block.lineHeight, {
 *     font: mkFont(block.size),
 *   }),
 * )
 * ```
 */
export function fitTextBlock(
  text: string,
  sizes: readonly number[],
  makeFont: (size: number) => string,
  box: { width: number; height: number },
  lineHeightRatio = 1.2,
): TextBlock {
  let last: TextBlock | null = null
  for (const size of sizes) {
    const lineHeight = size * lineHeightRatio
    const maxLines = Math.max(1, Math.floor(box.height / lineHeight))
    const { lines, truncated } = wrapTextInfo(
      text,
      makeFont(size),
      box.width,
      maxLines,
    )
    last = { lines, size, lineHeight, truncated }
    if (!truncated) return last
  }
  return (
    last ?? { lines: [], size: sizes[0] ?? 12, lineHeight: 0, truncated: false }
  )
}

// Rich text: a paragraph mixing weights, e.g. "add 2k to budget OR gain 3
// approvals" with the values bold. `fillText` takes one font per call, so a
// mixed-weight line is drawn as several runs, each with its own font and x
// offset. Word breaking still happens on whitespace; a run boundary that falls
// mid-word (no space between spans) keeps both runs in the same unbreakable word.

/** One weight-tagged piece of a rich paragraph, as authored. */
export interface TextSpan {
  text: string
  bold?: boolean
}

/**
 * A positioned run inside a laid-out line. `x` is the offset from the line
 * start.
 */
export interface RichRun {
  text: string
  bold: boolean
  x: number
}

/** One laid-out line. `width` is the drawn width, excluding any trailing space. */
export interface RichLine {
  runs: RichRun[]
  width: number
}

/** A rich paragraph laid out to fit a box. */
export interface RichBlock {
  lines: RichLine[]
  /** The size from `sizes` that was used. */
  size: number
  /** Baseline-to-baseline spacing for `lines`. */
  lineHeight: number
  /** True when even the smallest size had to drop words. */
  truncated: boolean
}

interface RichWord {
  runs: { text: string; bold: boolean }[]
}

/**
 * Split spans into words. Whitespace is a break point and is dropped; adjacent
 * non-space pieces (including across a weight change) join into one word so a
 * bold value glued to plain text is never broken apart.
 */
function splitRichWords(spans: readonly TextSpan[]): RichWord[] {
  const words: RichWord[] = []
  let current: RichWord | null = null
  for (const span of spans) {
    if (!span.text) continue
    const bold = span.bold ?? false
    for (const piece of span.text.split(/(\s+)/)) {
      if (!piece) continue
      if (/^\s+$/.test(piece)) {
        current = null
      } else {
        if (!current) {
          current = { runs: [] }
          words.push(current)
        }
        current.runs.push({ text: piece, bold })
      }
    }
  }
  return words
}

/** Append an ellipsis to a line, trimming the last run when it would overflow. */
function ellipsizeRichLine(
  line: RichLine,
  maxWidth: number,
  fontFor: (bold: boolean) => string,
): void {
  const ellW = textWidth(ELLIPSIS, fontFor(false))
  if (line.width + ellW <= maxWidth) {
    line.runs.push({ text: ELLIPSIS, bold: false, x: line.width })
    line.width += ellW
    return
  }
  const last = line.runs[line.runs.length - 1]
  if (!last) return
  const font = fontFor(last.bold)
  let text = last.text
  while (text.length > 0) {
    text = text.slice(0, -1)
    const runW = textWidth(text, font)
    if (last.x + runW + ellW <= maxWidth) {
      last.text = text
      line.runs.push({ text: ELLIPSIS, bold: false, x: last.x + runW })
      line.width = last.x + runW + ellW
      return
    }
  }
  last.text = ELLIPSIS
  last.bold = false
  line.width = last.x + ellW
}

/**
 * Lay one line out from its word indices, coalescing neighbouring pieces of the
 * same weight (with the space between words folded in) into one run each, so a
 * line renders as one `fillText`/label per weight span rather than one per
 * word.
 */
function buildLine(
  idxs: readonly number[],
  words: readonly RichWord[],
  fontFor: (bold: boolean) => string,
): RichLine {
  const segs: { text: string; bold: boolean }[] = []
  idxs.forEach((wi, k) => {
    if (k > 0) {
      segs.push({ text: ' ', bold: segs[segs.length - 1]?.bold ?? false })
    }
    for (const r of words[wi]!.runs) segs.push({ text: r.text, bold: r.bold })
  })
  const runs: RichRun[] = []
  let x = 0
  for (const seg of segs) {
    const last = runs[runs.length - 1]
    if (last && last.bold === seg.bold) last.text += seg.text
    else runs.push({ text: seg.text, bold: seg.bold, x })
    x += textWidth(seg.text, fontFor(seg.bold))
  }
  return { runs, width: x }
}

function wrapRichInfo(
  spans: readonly TextSpan[],
  makeFont: (bold: boolean) => string,
  maxWidth: number,
  maxLines: number,
): { lines: RichLine[]; truncated: boolean } {
  const fontNormal = makeFont(false)
  const fontBold = makeFont(true)
  const key =
    fontNormal +
    '|' +
    fontBold +
    '|' +
    maxWidth.toFixed(1) +
    '|' +
    maxLines +
    '|' +
    spans.map((s) => (s.bold ? '1' : '0') + s.text).join(' ')
  const hit = richCache.get(key)
  if (hit) return hit

  const fontFor = (bold: boolean): string => (bold ? fontBold : fontNormal)
  const spaceW = textWidth(' ', fontNormal)
  const words = splitRichWords(spans)
  const wordW = words.map((w) =>
    w.runs.reduce((sum, r) => sum + textWidth(r.text, fontFor(r.bold)), 0),
  )

  const lineWords: number[][] = []
  let cur: number[] = []
  let curW = 0
  let truncated = false
  for (let i = 0; i < words.length; i++) {
    const ww = wordW[i]!
    if (cur.length === 0) {
      // A single word is never split, so the first word on a line goes down
      // even when it is wider than the box.
      cur = [i]
      curW = ww
    } else if (curW + spaceW + ww <= maxWidth) {
      cur.push(i)
      curW += spaceW + ww
    } else {
      lineWords.push(cur)
      if (lineWords.length >= maxLines) {
        truncated = true
        cur = []
        break
      }
      cur = [i]
      curW = ww
    }
  }
  if (cur.length) lineWords.push(cur)

  const lines = lineWords.map((idxs) => buildLine(idxs, words, fontFor))
  if (truncated && lines.length) {
    ellipsizeRichLine(lines[lines.length - 1]!, maxWidth, fontFor)
  }

  const result = { lines, truncated }
  if (richCache.size >= CACHE_MAX) richCache.clear()
  richCache.set(key, result)
  return result
}

/**
 * Break rich `spans` into at most `maxLines` lines that fit `maxWidth`,
 * carrying each run's weight through and emitting per-run x offsets so the
 * caller can draw each run with its own font.
 *
 * ```ts
 * for (const line of wrapRichText(
 *   spans,
 *   (bold) => font(bold ? 700 : 400),
 *   w,
 * )) {
 *   for (const run of line.runs) {
 *     gfx.fillText(run.text, x + run.x, y, {
 *       font: font(run.bold ? 700 : 400),
 *     })
 *   }
 *   y += lineHeight
 * }
 * ```
 */
export function wrapRichText(
  spans: readonly TextSpan[],
  makeFont: (bold: boolean) => string,
  maxWidth: number,
  maxLines = 3,
): RichLine[] {
  return wrapRichInfo(spans, makeFont, maxWidth, maxLines).lines
}

/**
 * {@link fitTextBlock} for rich spans: the largest size from `sizes` (largest
 * first) whose wrapped lines fit `box` whole, falling back to the smallest,
 * truncated. `makeFont` takes the size and the weight.
 */
export function fitRichTextBlock(
  spans: readonly TextSpan[],
  sizes: readonly number[],
  makeFont: (size: number, bold: boolean) => string,
  box: { width: number; height: number },
  lineHeightRatio = 1.2,
): RichBlock {
  let last: RichBlock | null = null
  for (const size of sizes) {
    const lineHeight = size * lineHeightRatio
    const maxLines = Math.max(1, Math.floor(box.height / lineHeight))
    const { lines, truncated } = wrapRichInfo(
      spans,
      (bold) => makeFont(size, bold),
      box.width,
      maxLines,
    )
    last = { lines, size, lineHeight, truncated }
    if (!truncated) return last
  }
  return (
    last ?? { lines: [], size: sizes[0] ?? 12, lineHeight: 0, truncated: false }
  )
}

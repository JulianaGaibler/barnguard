// Text measuring helpers built on `measureText`.
//
// Label rendering is single-line by contract: `fillText` bakes one string into
// one cached bitmap, and there is no rect clip to fall back on, only a bitmap
// mask. Anything that has to sit inside a fixed box therefore has to be broken
// into lines and truncated before it is drawn, which is what these do.
//
// Measuring shapes the string in Canvas 2D, so it is not free. Every level
// memoizes: the shaping itself, the wrapped lines, and the rich-text runs. A
// node redrawing static text every frame therefore pays nothing after the
// first.

import {
  fontMetrics,
  measureText,
  parseFontSizePx,
  type LabelMetrics,
} from './rasterizeLabel'

const metricCache = new Map<string, LabelMetrics>()
const cache = new Map<string, { lines: string[]; truncated: boolean }>()
const richCache = new Map<string, { lines: RichLine[]; truncated: boolean }>()
/** Bounded so a long-running scene cannot grow a cache without limit. */
const CACHE_MAX = 512
const ELLIPSIS = '\u2026'
/** Opens a box's cache key. Spans are joined on NUL, so these have to differ. */
const BOX_KEY_SIGIL = '\u0001'
const BOX_KEY_FIELD = '\u0002'

/**
 * Drop the oldest entry once over budget. `Map` iterates in insertion order, so
 * with a delete-then-set on every hit this is a whole LRU and it allocates
 * nothing, which matters on a path called once per word.
 */
function evict<T>(map: Map<string, T>): void {
  if (map.size <= CACHE_MAX) return
  const oldest = map.keys().next().value
  if (oldest !== undefined) map.delete(oldest)
}

/**
 * Width of one line, in the same local units `fillText` draws in.
 *
 * @example
 *   const w = textWidth('Design Systems Lead', '600 24px Inter, sans-serif')
 */
export function textWidth(text: string, font: string): number {
  return metrics(text, font).localW
}

/**
 * Pen advance of one run, in the same local units `fillText` draws in.
 *
 * Use this, not {@link textWidth}, to place a run after another on the same
 * line: `textWidth` is the label bitmap's box, which carries transparent
 * padding, so stepping by it leaves a gap between the runs.
 *
 * @example
 *   gfx.fillText('3', x, y, style)
 *   gfx.fillText('k', x + textAdvance('3', font), y, smallStyle)
 */
export function textAdvance(text: string, font: string): number {
  return metrics(text, font).advance
}

function metrics(text: string, font: string): LabelMetrics {
  const key = font + '\n' + text
  const hit = metricCache.get(key)
  if (hit) {
    metricCache.delete(key)
    metricCache.set(key, hit)
    return hit
  }
  const out = measureText(text, {
    font,
    align: 'left',
    baseline: 'alphabetic',
    color: '#000',
  })
  metricCache.set(key, out)
  evict(metricCache)
  return out
}

/** Everything known about one string in one font, shaped once and cached. */
export interface TextMeasure {
  /**
   * Pen advance: how far the origin moves after drawing. This is the width to
   * lay out with, and it is not {@link textWidth}, which is the bitmap box and
   * carries transparent padding.
   */
  advance: number
  /** Ink height above the alphabetic baseline, for this string. */
  ascent: number
  /** Ink depth below the alphabetic baseline, for this string. */
  descent: number
  /** Baseline to the top of a capital. Font-wide, so it does not vary by string. */
  capHeight: number
  /** Natural baseline-to-baseline distance. Font-wide. */
  lineHeight: number
}

/**
 * Measure `text` in `font`, shaping once and caching the result.
 *
 * @remarks
 *   The per-string `ascent` and `descent` bound this exact text, so they are what
 *   a box has to hold. `capHeight` and `lineHeight` come from the font and are
 *   stable across strings, which is what makes them safe to lay a block out
 *   on.
 * @example
 *   // A chip that hugs its label, padded by a known amount rather than by
 *   // whatever transparent border the bitmap happened to carry.
 *   const m = textMetrics(label, font)
 *   gfx.fillRoundRect(
 *     x,
 *     y,
 *     m.advance + padX * 2,
 *     m.ascent + m.descent + padY * 2,
 *     r,
 *     fill,
 *   )
 *   gfx.fillText(label, x + padX, y + padY + m.ascent, {
 *     font,
 *     baseline: 'alphabetic',
 *   })
 */
export function textMetrics(text: string, font: string): TextMeasure {
  const m = metrics(text, font)
  const fm = fontMetrics(font)
  return {
    advance: m.advance,
    ascent: m.ascent,
    descent: m.descent,
    capHeight: fm.capHeight,
    lineHeight: fm.lineHeight,
  }
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
 * @remarks
 *   Breaks on whitespace only. A single word wider than `maxWidth` is left
 *   overlong rather than split mid-word, so a long identifier stays readable.
 *   If the text needs more lines than allowed, the last one is ellipsized.
 * @example
 *   const lines = wrapText(card.rules, font, box.width - 16, 3)
 *   lines.forEach((line, i) => {
 *     gfx.fillText(line, x, y + i * lineHeight, style)
 *   })
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
  // Floor rather than round: a box measured at 100.8 that keyed as 101 could
  // admit a word that then overhangs the real edge.
  const key = font + ' ' + Math.floor(maxWidth) + ' ' + maxLines + ' ' + text
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
  cache.set(key, { lines, truncated })
  evict(cache)
  return { lines, truncated }
}

/**
 * Largest size in `sizes` whose rendering of `text` fits `maxWidth`.
 *
 * Pass `sizes` largest first. Falls back to the last entry when nothing fits,
 * so pair it with {@link ellipsize} if the text must not overflow.
 *
 * @example
 *   const size = fitFontSize(
 *     name,
 *     [28, 24, 20, 16],
 *     (s) => `600 ${s}px Inter`,
 *     w,
 *   )
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

/**
 * Drop every memoized measurement, wrap and fit.
 *
 * These caches hold results shaped against whichever face was available at the
 * time, so a webfont that arrives after layout has run leaves text
 * mispositioned until they are cleared. That is worse than the label atlas
 * going stale, which only looks wrong. Pair with `clearFontMetricsCache()` and
 * `Engine.invalidateText()`.
 */
export function clearTextLayoutCaches(): void {
  metricCache.clear()
  cache.clear()
  richCache.clear()
}

/** @deprecated Use {@link clearTextLayoutCaches}. */
export const _resetTextLayoutCacheForTests = clearTextLayoutCaches

/**
 * Distance from a block's top edge to its first baseline, and the block's true
 * height. A block of `n` lines spans `n - 1` gaps plus one line box, so the
 * trailing leading is not part of it. Counting `n * lineHeight` instead adds a
 * phantom line, which is what makes a centred block sit high.
 */
function blockBox(
  lineCount: number,
  lineHeight: number,
  lb: LineBox,
): { firstBaselineY: number; height: number } {
  return {
    firstBaselineY: lb.ascent,
    height:
      lineCount > 0 ? (lineCount - 1) * lineHeight + lb.ascent + lb.descent : 0,
  }
}

/**
 * How many lines of `lineHeight` fit in `height`, given that the last line
 * needs its full box rather than just its leading.
 */
function lineBudget(height: number, lineHeight: number, lb: LineBox): number {
  return Math.max(
    1,
    Math.floor((height - (lb.ascent + lb.descent)) / lineHeight) + 1,
  )
}

/**
 * What one line reserves above and below its baseline. `FontMetrics` satisfies
 * this, so plain text passes the typeface's own figures. Rich text passes a
 * pair widened by any inline box, which is the only thing that makes a line
 * taller than the font asks for.
 */
interface LineBox {
  ascent: number
  descent: number
}

/** A block of text laid out to fit a box. */
export interface TextBlock {
  lines: string[]
  /** The size from `sizes` that was used. */
  size: number
  /** Baseline-to-baseline spacing for `lines`. */
  lineHeight: number
  /**
   * Top of the block to the first line's alphabetic baseline. Draw line `i` at
   * `top + firstBaselineY + i * lineHeight` with `baseline: 'alphabetic'`.
   */
  firstBaselineY: number
  /** Height the lines actually occupy, for centring the block in a box. */
  height: number
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
 * @remarks
 *   `lineHeightRatio` scales the font's own baseline-to-baseline distance, so `1`
 *   is the typeface's natural spacing rather than a guess at it.
 * @example
 *   const block = fitTextBlock(card.rules, [16, 14, 12, 10], mkFont, box)
 *   const top = box.y + (box.height - block.height) / 2
 *   block.lines.forEach((line, i) => {
 *     const baseline = top + block.firstBaselineY + i * block.lineHeight
 *     gfx.fillText(line, box.x, baseline, {
 *       font: mkFont(block.size),
 *       baseline: 'alphabetic',
 *     })
 *   })
 */
export function fitTextBlock(
  text: string,
  sizes: readonly number[],
  makeFont: (size: number) => string,
  box: { width: number; height: number },
  lineHeightRatio = 1,
): TextBlock {
  let last: TextBlock | null = null
  for (const size of sizes) {
    const font = makeFont(size)
    const fm = fontMetrics(font)
    const lineHeight = fm.lineHeight * lineHeightRatio
    const { lines, truncated } = wrapTextInfo(
      text,
      font,
      box.width,
      lineBudget(box.height, lineHeight, fm),
    )
    last = {
      lines,
      size,
      lineHeight,
      truncated,
      ...blockBox(lines.length, lineHeight, fm),
    }
    if (!truncated) return last
  }
  return (
    last ?? {
      lines: [],
      size: sizes[0] ?? 12,
      lineHeight: 0,
      firstBaselineY: 0,
      height: 0,
      truncated: false,
    }
  )
}

// Rich text: a paragraph mixing weights, e.g. "add 2k to budget OR gain 3
// approvals" with the values bold. `fillText` takes one font per call, so a
// mixed-weight line is drawn as several runs, each with its own font and x
// offset. Word breaking still happens on whitespace. A run boundary that falls
// mid-word (no space between spans) keeps both runs in the same unbreakable word.
//
// A line can also carry inline boxes: icons and small diagrams the caller
// paints itself. They are measured and positioned here and drawn there, so
// this file needs no notion of what a box holds. A box breaks run coalescing,
// so an iconised paragraph draws more labels per line than a prose one.

/** One piece of a rich paragraph, as authored. */
export type TextSpan = TextRun | InlineBox

/** A weight-tagged run of text. */
export interface TextRun {
  text: string
  bold?: boolean
}

/**
 * A box laid out among the words and painted by the caller: an icon, a badge, a
 * small diagram. The engine measures, wraps and positions it, and never draws
 * it, so it needs no image, only a size and a name to hand back.
 *
 * Sizes are in em so a box tracks whichever size {@link fitRichTextBlock}
 * settles on. The box sits centred on the font's cap height, level with the
 * digits beside it.
 *
 * @remarks
 *   A box is not whitespace, so it never breaks a word: it welds to whatever sits
 *   against it, which is what keeps a badge with the number it qualifies. Put a
 *   space span beside it, or give it `leadEm` or `trailEm`, wherever that is
 *   not wanted.
 * @example
 *   const spans: TextSpan[] = [
 *     { text: 'per ' },
 *     { box: 'badge:design', heightEm: 1.2, aspect: 1, alt: 'Design' },
 *   ]
 *   for (const line of wrapRichText(spans, font, box.width)) {
 *     for (const run of line.runs) {
 *       if (run.kind === 'box') {
 *         drawBadge(run.box, x + run.x, y + run.y, run.width, run.height)
 *       } else {
 *         gfx.fillText(run.text, x + run.x, y, { font: font(run.bold) })
 *       }
 *     }
 *   }
 */
export interface InlineBox {
  /** The caller's name for the box, handed back on the laid-out run. */
  box: string
  /** Height as a multiple of the font size. */
  heightEm: number
  /** Width over height. */
  aspect: number
  /** Space before the box, in em. */
  leadEm?: number
  /** Space after the box, in em. */
  trailEm?: number
  /**
   * What the box says, for {@link richText} and anything else reading spans
   * back.
   */
  alt?: string
}

/** A positioned piece of a laid-out line. `x` is the offset from the line start. */
export type RichRun = RichTextRun | RichBoxRun

/** A run of glyphs on a line, drawn with one `fillText`. */
export interface RichTextRun {
  kind: 'text'
  text: string
  bold: boolean
  x: number
}

/** An inline box reserving space on a line, for the caller to paint into. */
export interface RichBoxRun {
  kind: 'box'
  box: string
  /** Left edge of the painted rect, so `leadEm` is already spent. */
  x: number
  /** Top of the painted rect relative to the line's alphabetic baseline. */
  y: number
  width: number
  height: number
}

/** One laid-out line. `width` is the drawn width, excluding any trailing space. */
export interface RichLine {
  runs: RichRun[]
  width: number
}

function isBox(span: TextSpan): span is InlineBox {
  return 'box' in span
}

/**
 * Read a rich paragraph back as one string, taking each box's `alt`.
 *
 * Iconography destroys the plain-text form of a sentence: spans reading "gain",
 * box, "per", box have no words left for the parts that matter. This puts them
 * back, for a log line, a tooltip, or a screen reader.
 *
 * @example
 *   richText([
 *     { text: 'per ' },
 *     { box: 'b', heightEm: 1, aspect: 1, alt: 'Design' },
 *   ])
 *   // 'per Design'
 */
export function richText(spans: readonly TextSpan[]): string {
  return spans.map((s) => (isBox(s) ? (s.alt ?? '') : s.text)).join('')
}

/** A rich paragraph laid out to fit a box. */
export interface RichBlock {
  lines: RichLine[]
  /** The size from `sizes` that was used. */
  size: number
  /** Baseline-to-baseline spacing for `lines`. */
  lineHeight: number
  /**
   * Top of the block to the first line's alphabetic baseline. Draw line `i` at
   * `top + firstBaselineY + i * lineHeight` with `baseline: 'alphabetic'`.
   */
  firstBaselineY: number
  /** Height the lines actually occupy, for centring the block in a box. */
  height: number
  /** True when even the smallest size had to drop words. */
  truncated: boolean
}

interface RichWord {
  runs: RichPiece[]
}

/** One indivisible piece of a word: a text fragment or a box. */
type RichPiece =
  | { text: string; bold: boolean }
  | { box: string; width: number; height: number; lead: number; trail: number }

function isBoxPiece(
  piece: RichPiece,
): piece is Extract<RichPiece, { box: string }> {
  return 'box' in piece
}

/** Resolve a box's em sizes against the font it sits in. */
function boxPiece(
  span: InlineBox,
  size: number,
): Extract<RichPiece, { box: string }> {
  const height = Math.max(0, span.heightEm) * size
  return {
    box: span.box,
    height,
    width: height * Math.max(0, span.aspect),
    lead: (span.leadEm ?? 0) * size,
    trail: (span.trailEm ?? 0) * size,
  }
}

/** The advance a piece contributes, boxes included. */
function pieceWidth(
  piece: RichPiece,
  fontFor: (bold: boolean) => string,
): number {
  return isBoxPiece(piece)
    ? piece.lead + piece.width + piece.trail
    : textAdvance(piece.text, fontFor(piece.bold))
}

/**
 * Split spans into words. Whitespace is a break point and is dropped. Adjacent
 * non-space pieces (including across a weight change, and including boxes) join
 * into one word so a bold value glued to plain text, or a badge glued to the
 * number it qualifies, is never broken apart.
 */
function splitRichWords(spans: readonly TextSpan[], size: number): RichWord[] {
  const words: RichWord[] = []
  let current: RichWord | null = null
  const open = (): RichWord => {
    if (!current) {
      current = { runs: [] }
      words.push(current)
    }
    return current
  }
  for (const span of spans) {
    if (isBox(span)) {
      const piece = boxPiece(span, size)
      // A zero-area box would still break run coalescing for nothing.
      if (piece.width > 0 && piece.height > 0) open().runs.push(piece)
      continue
    }
    if (!span.text) continue
    const bold = span.bold ?? false
    for (const piece of span.text.split(/(\s+)/)) {
      if (!piece) continue
      if (/^\s+$/.test(piece)) {
        current = null
      } else {
        open().runs.push({ text: piece, bold })
      }
    }
  }
  return words
}

/**
 * Append an ellipsis to a line, trimming the last run when it would overflow.
 *
 * A box has no characters to give back, so it goes whole. Its run records the
 * painted left edge rather than the pre-lead advance, so reclaiming to `x`
 * under-counts the lead by a pixel or so and the line ellipsizes marginally
 * early. That is the safe direction.
 */
function ellipsizeRichLine(
  line: RichLine,
  maxWidth: number,
  fontFor: (bold: boolean) => string,
): void {
  const ellW = textAdvance(ELLIPSIS, fontFor(false))
  const ellipsisRun = (x: number): RichTextRun => ({
    kind: 'text',
    text: ELLIPSIS,
    bold: false,
    x,
  })
  if (line.width + ellW <= maxWidth) {
    line.runs.push(ellipsisRun(line.width))
    line.width += ellW
    return
  }
  while (line.runs.length) {
    const tail = line.runs[line.runs.length - 1]!
    if (tail.kind !== 'box') break
    line.runs.pop()
    line.width = tail.x
    if (line.width + ellW <= maxWidth) {
      line.runs.push(ellipsisRun(line.width))
      line.width += ellW
      return
    }
  }
  const last = line.runs[line.runs.length - 1]
  if (!last || last.kind !== 'text') {
    line.runs.push(ellipsisRun(0))
    line.width = ellW
    return
  }
  const font = fontFor(last.bold)
  let text = last.text
  while (text.length > 0) {
    text = text.slice(0, -1)
    const runW = textAdvance(text, font)
    if (last.x + runW + ellW <= maxWidth) {
      last.text = text
      line.runs.push(ellipsisRun(last.x + runW))
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
  capHeight: number,
): RichLine {
  const segs: RichPiece[] = []
  idxs.forEach((wi, k) => {
    if (k > 0) {
      // The space between two words takes the weight of the text before it. A
      // box carries no weight, so look past it for the run that does.
      let bold = false
      for (let i = segs.length - 1; i >= 0; i--) {
        const seg = segs[i]!
        if (!isBoxPiece(seg)) {
          bold = seg.bold
          break
        }
      }
      segs.push({ text: ' ', bold })
    }
    segs.push(...words[wi]!.runs)
  })
  const runs: RichRun[] = []
  let x = 0
  for (const seg of segs) {
    if (isBoxPiece(seg)) {
      runs.push({
        kind: 'box',
        box: seg.box,
        x: x + seg.lead,
        y: -(capHeight + seg.height) / 2,
        width: seg.width,
        height: seg.height,
      })
    } else {
      const last = runs[runs.length - 1]
      if (last && last.kind === 'text' && last.bold === seg.bold) {
        last.text += seg.text
      } else {
        runs.push({ kind: 'text', text: seg.text, bold: seg.bold, x })
      }
    }
    x += pieceWidth(seg, fontFor)
  }
  return { runs, width: x }
}

/**
 * A span's contribution to the wrap cache key. The font strings in the key
 * already carry the size, so a box's pixel width is keyed by proxy, but its em
 * figures come from the caller and two callers can lay one box out at two
 * heights. The text form always opens with the weight digit, so the sigil
 * cannot collide with it.
 */
function spanKey(span: TextSpan): string {
  if (!isBox(span)) return (span.bold ? '1' : '0') + span.text
  const { box, heightEm, aspect, leadEm = 0, trailEm = 0 } = span
  return [BOX_KEY_SIGIL + box, heightEm, aspect, leadEm, trailEm].join(
    BOX_KEY_FIELD,
  )
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
    Math.floor(maxWidth) +
    '|' +
    maxLines +
    '|' +
    spans.map(spanKey).join('\u0000')
  const hit = richCache.get(key)
  if (hit) return hit

  const fontFor = (bold: boolean): string => (bold ? fontBold : fontNormal)
  const spaceW = textAdvance(' ', fontNormal)
  const { capHeight } = fontMetrics(fontNormal)
  const words = splitRichWords(spans, parseFontSizePx(fontNormal))
  const wordW = words.map((w) =>
    w.runs.reduce((sum, r) => sum + pieceWidth(r, fontFor), 0),
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

  const lines = lineWords.map((idxs) =>
    buildLine(idxs, words, fontFor, capHeight),
  )
  if (truncated && lines.length) {
    ellipsizeRichLine(lines[lines.length - 1]!, maxWidth, fontFor)
  }

  const result = { lines, truncated }
  richCache.set(key, result)
  evict(richCache)
  return result
}

/**
 * Break rich `spans` into at most `maxLines` lines that fit `maxWidth`,
 * carrying each run's weight through and emitting per-run x offsets so the
 * caller can draw each run with its own font.
 *
 * @remarks
 *   `y` on a box run is relative to the same baseline the text is drawn on, and
 *   is negative, so a box and the digits beside it come out level.
 * @example
 *   const mkFont = (bold: boolean) => font(bold ? 700 : 400)
 *   for (const line of wrapRichText(spans, mkFont, w)) {
 *     for (const run of line.runs) {
 *       if (run.kind === 'box') {
 *         drawIcon(run.box, x + run.x, y + run.y, run.width, run.height)
 *       } else {
 *         gfx.fillText(run.text, x + run.x, y, { font: mkFont(run.bold) })
 *       }
 *     }
 *     y += lineHeight
 *   }
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
 * The line box a rich paragraph needs: the font's own, widened by any inline
 * box that overhangs it.
 *
 * A box centred on cap height reaches `(capHeight + height) / 2` above the
 * baseline, which passes the font's ascent at around nine tenths of an em, so
 * even a box the size of the text needs the extra room.
 *
 * One box box for the whole block, rather than one per line. `lineBudget` has
 * to say how many lines fit before any line exists, and a cached `RichLine` is
 * shared by every block built from that key, so there is nowhere to keep a
 * per-line figure. Uniform spacing also just reads better: lines of different
 * heights inside one paragraph look like a mistake.
 */
function richLineBox(spans: readonly TextSpan[], font: string): LineBox {
  const fm = fontMetrics(font)
  const size = parseFontSizePx(font)
  let { ascent, descent } = fm
  for (const span of spans) {
    if (!isBox(span)) continue
    const h = Math.max(0, span.heightEm) * size
    ascent = Math.max(ascent, (fm.capHeight + h) / 2)
    descent = Math.max(descent, (h - fm.capHeight) / 2)
  }
  return { ascent, descent }
}

/**
 * {@link fitTextBlock} for rich spans: the largest size from `sizes` (largest
 * first) whose wrapped lines fit `box` whole, falling back to the smallest,
 * truncated. `makeFont` takes the size and the weight.
 *
 * An inline box taller than the text raises the line height, which cuts the
 * line budget, which can drop the block a rung down `sizes`. Boxes much over an
 * em pay for themselves in smaller text.
 */
export function fitRichTextBlock(
  spans: readonly TextSpan[],
  sizes: readonly number[],
  makeFont: (size: number, bold: boolean) => string,
  box: { width: number; height: number },
  lineHeightRatio = 1,
): RichBlock {
  let last: RichBlock | null = null
  for (const size of sizes) {
    // Line spacing follows the upright weight, so a bold run on a line does not
    // push its neighbours apart.
    const font = makeFont(size, false)
    const lb = richLineBox(spans, font)
    const lineHeight =
      Math.max(fontMetrics(font).lineHeight, lb.ascent + lb.descent) *
      lineHeightRatio
    const { lines, truncated } = wrapRichInfo(
      spans,
      (bold) => makeFont(size, bold),
      box.width,
      lineBudget(box.height, lineHeight, lb),
    )
    last = {
      lines,
      size,
      lineHeight,
      truncated,
      ...blockBox(lines.length, lineHeight, lb),
    }
    if (!truncated) return last
  }
  return (
    last ?? {
      lines: [],
      size: sizes[0] ?? 12,
      lineHeight: 0,
      firstBaselineY: 0,
      height: 0,
      truncated: false,
    }
  )
}

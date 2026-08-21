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

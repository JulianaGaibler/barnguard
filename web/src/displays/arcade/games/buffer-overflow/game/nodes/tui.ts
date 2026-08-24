/**
 * The drawing vocabulary of a terminal application, built from strokes and
 * rectangles.
 *
 * Every framed pane, meter, key cap and readout in the game is assembled from
 * the functions below, so the look is defined in one place and a change to a
 * rule width or a bracket reaches the whole screen at once.
 *
 * Nothing here rasterizes a grid of characters. A box rule is four `strokeLine`
 * calls, a meter is a run of small quads, and only actual words and numbers are
 * text. That is what keeps a dense screen inside a single instanced batch.
 *
 * Two constraints shape most of the code:
 *
 * Rules are an integer number of device pixels. A hairline that scales with the
 * board stops being a hairline, and one that lands on a fractional device pixel
 * blurs, so widths arrive in CSS pixels and go through `snapSize`.
 *
 * Nothing overlaps. `COLORS.rule` is translucent, and two translucent strokes
 * crossing double-blend into a visibly darker notch, so a frame's horizontals
 * span the full width and its verticals stop short of them rather than meeting
 * corner to corner.
 */
import { clamp, textAdvance, textMetrics, type Gfx2D } from '@src/stargazer'
import { ANIM, FRAME } from '../tuning'
import type { Bounds } from '../types'

/** A run cut into a frame's top rule. */
export interface FrameLabel {
  text: string
  font: string
  color: string
}

export interface FrameStyle {
  color: string
  /** World units, already snapped. See {@link ruleWidth}. */
  width: number
  /** Painted inside the rule. Omitted leaves whatever is underneath. */
  fill?: string
  /** Cut into the top rule from the left. */
  title?: FrameLabel
  /** Cut into the same rule from the right, dropped when the two would meet. */
  trailing?: FrameLabel
}

/**
 * A rule width in world units, rounded to a whole device pixel and never below
 * one.
 *
 * `scale` is `camera.strokeSpaceScale()`, the world units in one CSS pixel.
 */
export function ruleWidth(gfx: Gfx2D, cssPx: number, scale: number): number {
  return gfx.snapSize(cssPx * scale)
}

/** The baseline that centres `font`'s capitals on `centreY`. */
export function capBaseline(centreY: number, font: string): number {
  return centreY + textMetrics('0', font).capHeight / 2
}

/**
 * A box rule with its title cut into the top edge.
 *
 * The title interrupts the rule rather than floating above it, which is what
 * makes a pane read as one object instead of a caption next to a box. The gap
 * is measured from the text's own advance plus a character of padding on each
 * side, because a tight crop on a monospace face breaks the grid illusion.
 *
 * @remarks
 *   The gap is a plain break rather than drawn `─┤ title ├─` box glyphs. A
 *   glyph's stroke weight is whatever the font says and these rules are exactly
 *   one device pixel, so the two would never line up.
 */
export function drawFrame(gfx: Gfx2D, r: Bounds, s: FrameStyle): void {
  if (r.width <= 0 || r.height <= 0) return
  if (s.fill) gfx.fillRoundRect(r.x, r.y, r.width, r.height, 0, s.fill)

  const w = s.width
  const half = w / 2
  const left = r.x
  const right = r.x + r.width
  const top = r.y + half
  const bottom = r.y + r.height - half
  const stroke = { color: s.color, width: w, cap: 'butt' as const }

  // Verticals stop short of the horizontals rather than crossing them, so no
  // two translucent strokes ever overlap.
  gfx.strokeLine(left + half, r.y + w, left + half, r.y + r.height - w, stroke)
  gfx.strokeLine(
    right - half,
    r.y + w,
    right - half,
    r.y + r.height - w,
    stroke,
  )
  gfx.strokeLine(left, bottom, right, bottom, stroke)

  const spans = titleSpans(r, s)
  let x = left
  for (const span of spans) {
    if (span.from > x) gfx.strokeLine(x, top, span.from, top, stroke)
    x = span.to
    const cy = r.y + half
    gfx.fillText(
      span.label.text,
      span.textX,
      capBaseline(cy, span.label.font),
      {
        font: span.label.font,
        align: 'left',
        baseline: 'alphabetic',
        color: span.label.color,
      },
    )
  }
  if (x < right) gfx.strokeLine(x, top, right, top, stroke)
}

interface TitleSpan {
  from: number
  to: number
  textX: number
  label: FrameLabel
}

/**
 * Where the top rule breaks, left to right.
 *
 * Split out because it is the only part of {@link drawFrame} with a decision in
 * it: a trailing run is dropped whole when the two gaps would meet, since half
 * a run reads as a bug rather than as a tight fit.
 */
function titleSpans(r: Bounds, s: FrameStyle): TitleSpan[] {
  const out: TitleSpan[] = []
  const inner = r.x + r.width
  let titleEnd = r.x
  if (s.title) {
    const pad = textAdvance('0', s.title.font) * FRAME.padChars
    const textX = r.x + pad * 2
    titleEnd = textX + textAdvance(s.title.text, s.title.font)
    out.push({ from: textX - pad, to: titleEnd + pad, textX, label: s.title })
  }
  if (s.trailing) {
    const pad = textAdvance('0', s.trailing.font) * FRAME.padChars
    const adv = textAdvance(s.trailing.text, s.trailing.font)
    const textX = inner - pad * 2 - adv
    const from = textX - pad
    if (from > titleEnd + pad) {
      out.push({ from, to: textX + adv + pad, textX, label: s.trailing })
    }
  }
  return out
}

/** The rect inside a frame, inset by its rule and by `pad`. */
export function frameBody(r: Bounds, rule: number, pad: number): Bounds {
  const inset = rule + pad
  return {
    x: r.x + inset,
    y: r.y + inset,
    width: Math.max(0, r.width - inset * 2),
    height: Math.max(0, r.height - inset * 2),
  }
}

/**
 * A divider between two sections of a pane, at world `y`.
 *
 * `r` is the pane's outer rect, and the divider stops short of its side rules
 * for the same non-overlap reason the frame's own verticals do.
 */
export function drawDivider(
  gfx: Gfx2D,
  r: Bounds,
  y: number,
  color: string,
  rule: number,
): void {
  if (r.width <= rule * 2) return
  gfx.strokeLine(r.x + rule, y, r.x + r.width - rule, y, {
    color,
    width: rule,
    cap: 'butt',
  })
}

export interface MeterOptions {
  value: number
  max: number
  /** How many blocks the run is divided into. */
  cells: number
  color: string
  trackColor: string
  /** The `[` and `]` either side. Omitted draws a bare run. */
  bracket?: { color: string; width: number }
}

/**
 * How many of a meter's cells are lit.
 *
 * Rounds up, and floors any positive value at one cell, because a meter reading
 * empty while the thing it measures is still running is worse than a cell of
 * imprecision. A clock at half a second left still has a block.
 */
export function meterCells(value: number, max: number, cells: number): number {
  if (max <= 0 || cells <= 0) return 0
  const t = clamp(value / max, 0, 1)
  const n = Math.min(cells, Math.ceil(t * cells))
  return value > 0 ? Math.max(1, n) : Math.max(0, n)
}

/** An `htop` meter: a bracket pair around a run of block cells. */
export function drawMeter(gfx: Gfx2D, r: Bounds, o: MeterOptions): void {
  if (r.width <= 0 || r.height <= 0 || o.cells <= 0) return
  let x = r.x
  let w = r.width
  if (o.bracket) {
    const arm = Math.min(r.height * 0.28, r.width * 0.04)
    drawBracket(gfx, x, r.y, arm, r.height, o.bracket, 1)
    drawBracket(gfx, x + w, r.y, arm, r.height, o.bracket, -1)
    x += arm * 2
    w -= arm * 4
  }
  if (w <= 0) return

  const lit = meterCells(o.value, o.max, o.cells)
  const step = w / o.cells
  const gap = Math.min(step * 0.28, r.height * 0.14)
  const cellW = Math.max(step - gap, step * 0.4)
  for (let i = 0; i < o.cells; i++) {
    const color = i < lit ? o.color : o.trackColor
    gfx.fillRoundRect(x + i * step, r.y, cellW, r.height, 0, color)
  }
}

/** One square bracket: an upright with a serif top and bottom. */
function drawBracket(
  gfx: Gfx2D,
  x: number,
  y: number,
  arm: number,
  h: number,
  b: { color: string; width: number },
  dir: 1 | -1,
): void {
  const half = b.width / 2
  const ux = x + half * dir
  const stroke = { color: b.color, width: b.width, cap: 'butt' as const }
  gfx.strokeLine(ux, y + b.width, ux, y + h - b.width, stroke)
  gfx.strokeLine(x, y + half, x + arm * dir, y + half, stroke)
  gfx.strokeLine(x, y + h - half, x + arm * dir, y + h - half, stroke)
}

export interface InverseOptions {
  fill: string
  ink: string
  font: string
  align?: 'left' | 'center' | 'right'
  /** Inset from the edge the text is aligned to. */
  padX?: number
}

/** Inverse video: a solid bar with the text knocked out of it. */
export function drawInverse(
  gfx: Gfx2D,
  r: Bounds,
  text: string,
  o: InverseOptions,
): void {
  if (r.width <= 0 || r.height <= 0) return
  gfx.fillRoundRect(r.x, r.y, r.width, r.height, 0, o.fill)
  const align = o.align ?? 'left'
  const pad = o.padX ?? textAdvance('0', o.font)
  const x =
    align === 'left'
      ? r.x + pad
      : align === 'right'
        ? r.x + r.width - pad
        : r.x + r.width / 2
  gfx.fillText(text, x, capBaseline(r.y + r.height / 2, o.font), {
    font: o.font,
    align,
    baseline: 'alphabetic',
    color: o.ink,
  })
}

export interface CapOptions {
  /** The rule, and the fill once pressed. */
  rule: string
  width: number
  pressed?: boolean
  /** A doubled rule, for the action that commits. */
  heavy?: boolean
  /** What the cap's contents take when it is at rest. */
  ink: string
  /** What they take once the cap inverts. */
  pressedInk: string
  /** Painted inside the rule at rest. */
  fill?: string
  /** Dimmed contents, for a control that is momentarily unavailable. */
  disabled?: boolean
}

/**
 * A key cap, returning the color its contents should be drawn in.
 *
 * Pressing inverts the whole cap rather than sinking it. That is the terminal
 * idiom, and at arm's length a solid block appearing is a far faster read than
 * a face travelling two pixels.
 */
export function drawCap(gfx: Gfx2D, r: Bounds, o: CapOptions): string {
  if (r.width <= 0 || r.height <= 0) return o.ink
  if (o.pressed) {
    gfx.fillRoundRect(r.x, r.y, r.width, r.height, 0, o.rule)
    return o.pressedInk
  }
  if (o.fill) gfx.fillRoundRect(r.x, r.y, r.width, r.height, 0, o.fill)
  const w = o.width
  const half = w / 2
  const stroke = { color: o.rule, width: w, join: 'miter' as const }
  gfx.strokeRoundRect(
    r.x + half,
    r.y + half,
    r.width - w,
    r.height - w,
    0,
    stroke,
  )
  if (o.heavy) {
    const g = w * 2
    gfx.strokeRoundRect(
      r.x + half + g,
      r.y + half + g,
      r.width - w - g * 2,
      r.height - w - g * 2,
      0,
      stroke,
    )
  }
  return o.ink
}

export type RunAlign = 'left' | 'center' | 'right'

export interface RunOptions {
  x: number
  /** Baseline. Centre with {@link capBaseline}. */
  y: number
  font: string
  color: string
  /** One character's advance, measured once by the caller. */
  advance: number
  align?: RunAlign
}

/** The run's left edge relative to its anchor. */
export function runLayout(
  len: number,
  advance: number,
  align: RunAlign = 'left',
): number {
  if (align === 'center') return (-len * advance) / 2
  if (align === 'right') return -len * advance
  return 0
}

/**
 * One `fillText` per character, stepping by a fixed advance.
 *
 * A whole-string label is cached under the string itself, so a score counting
 * up mints a new cache entry every frame it animates, against a budget of
 * twenty-four rasterizations a frame and a cache of seven hundred and sixty
 * eight. Drawing character by character bounds every volatile number in the
 * game to about a dozen entries that never expire.
 *
 * It costs one instance per character instead of one per string, which is
 * nothing next to a page wipe, and it is only exact because the face is
 * monospace: each glyph is centred in its own cell, so the digits sit on a grid
 * rather than on an advance chain.
 */
export function drawRun(gfx: Gfx2D, text: string, o: RunOptions): void {
  const start = o.x + runLayout(text.length, o.advance, o.align)
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (ch === ' ') continue
    gfx.fillText(ch, start + i * o.advance + o.advance / 2, o.y, {
      font: o.font,
      align: 'center',
      baseline: 'alphabetic',
      color: o.color,
    })
  }
}

/** What a {@link withGlow} body is told about the pass it is drawing. */
export interface GlowPass {
  /** True on the additive pass underneath the real one. */
  glow: boolean
  /** World units to oversize by, so the pass reads as bleed. */
  spread: number
}

/**
 * Draw something twice, once additively underneath, for a phosphor bleed.
 *
 * Additive is what makes this safe. The warning against drawing a translucent
 * shape in two passes is about `source-over`, where the overlap double-blends
 * into a dark patch. Under `lighter` the overlap is the whole effect.
 *
 * @remarks
 *   A blend switch breaks the batch, so this is capped at two surfaces across the
 *   game: the banner word, and the clock meter once it is urgent. That is a
 *   limit rather than a starting point. Glow on every accent would cost a
 *   switch per pane and buy nothing, because bleed only reads where it has dark
 *   around it and where something is genuinely asking to be looked at.
 */
export function withGlow(
  gfx: Gfx2D,
  rule: number,
  body: (pass: GlowPass) => void,
): void {
  gfx.setBlend('lighter')
  gfx.setAlpha(FRAME.glowAlpha)
  body({ glow: true, spread: rule * FRAME.glowSpread })
  gfx.setAlpha(1)
  gfx.setBlend('source-over')
  body({ glow: false, spread: 0 })
}

/**
 * The shared cursor blink, so every cursor on screen blinks together.
 *
 * Square rather than eased, because a terminal cursor does not fade.
 */
export function cursorAlpha(timeSec: number): number {
  const phase = ((timeSec % ANIM.blink) + ANIM.blink) % ANIM.blink
  return phase < ANIM.blink / 2 ? 1 : 0
}

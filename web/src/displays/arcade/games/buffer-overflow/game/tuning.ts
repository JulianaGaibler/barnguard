/**
 * Every tunable knob: the palette, the frame geometry, the input timings and
 * the animation lengths.
 *
 * Geometry is expressed as fractions of a cell or of the region wherever it can
 * be, so everything scales with the booth screen instead of being pinned to one
 * resolution. Rule widths are the exception and are CSS pixels, because a
 * hairline that scales stops being a hairline. Timings are seconds of engine
 * time, so a paused game holds.
 *
 * `meta.ts` seeds the game's `themeTokens` from the constants below. The canvas
 * sits outside the themed container and cannot read a custom property back, so
 * one constant feeding both surfaces is the only thing keeping the DOM chrome
 * and the buffer in step.
 */
import { mixColor, withAlpha } from '@src/stargazer'
import type { PieceKind } from './types'

const INK = '#F4F0FA'

export const COLORS = {
  /** Backdrop gradient behind everything, corner to corner. */
  backdropTop: '#1E1628',
  backdropBottom: '#0B0710',
  /** The field pieces fall into. Near-black, so the shapes carry the color. */
  buffer: '#06040A',
  /** Hairline grid inside the buffer. */
  grid: withAlpha(INK, 0.05),
  /** Fill behind a pane, a step up from the backdrop so its edge reads. */
  pane: '#160F1E',
  /** Box rules and the dividers between pane sections. */
  rule: withAlpha(INK, 0.22),
  /** Dividers inside a pane, and the address gutter. */
  ruleFaint: withAlpha(INK, 0.1),
  /** One scanline bar. */
  scan: withAlpha('#000000', 0.15),
  ink: INK,
  inkSoft: withAlpha(INK, 0.62),
  /** Numerals and labels drawn on a fill too light for `ink`. */
  inkDark: '#120C1A',
  white: '#FFFFFF',
} as const

/**
 * The seven shapes' colors.
 *
 * The traditional hue per shape, deepened to sit on a near-black buffer without
 * glaring. Kept recognisable on purpose: a player who has met this shape
 * anywhere else already knows which one is the flat four, and re-teaching that
 * buys nothing.
 */
export const PIECE_COLORS: Record<PieceKind, string> = {
  I: '#22D3EE',
  O: '#FACC15',
  T: '#A855F7',
  S: '#4ADE80',
  Z: '#F43F5E',
  J: '#3B82F6',
  L: '#FB923C',
}

/** A row about to clear flashes to this before it collapses. */
export const CLEAR_FLASH = '#FFFFFF'

/**
 * The accent ramp, indexed by level.
 *
 * Drives the frame rules, the key caps, the meters and the readouts. The board
 * heats up as the game speeds up, which gives a long run a visible shape and
 * makes the level something the player sees rather than reads.
 *
 * The DOM overlays cannot follow this. `themeTokens` is a static object applied
 * once when the game mounts, so a running level has no way to reach it. They
 * take {@link ACCENT_CHROME} instead, a fixed point on this same ramp, which
 * keeps the menu and the pause card in the family without pretending to be
 * live.
 */
export const ACCENT_RAMP: readonly { level: number; color: string }[] = [
  { level: 1, color: '#4C6FE0' },
  { level: 5, color: '#8B5CE0' },
  { level: 10, color: '#E0459B' },
  { level: 15, color: '#E86A2C' },
]

/** The accent for `level`, interpolated between ramp stops. */
export function accentForLevel(level: number): string {
  const first = ACCENT_RAMP[0]
  const last = ACCENT_RAMP[ACCENT_RAMP.length - 1]
  if (level <= first.level) return first.color
  if (level >= last.level) return last.color
  for (let i = 1; i < ACCENT_RAMP.length; i++) {
    const hi = ACCENT_RAMP[i]
    if (level > hi.level) continue
    const lo = ACCENT_RAMP[i - 1]
    const t = (level - lo.level) / (hi.level - lo.level)
    return mixColor(lo.color, hi.color, t)
  }
  return last.color
}

/** The fixed accent the DOM chrome uses, from the middle of the ramp. */
export const ACCENT_CHROME = ACCENT_RAMP[1].color

/** Seat colors for the two-player race, drawn from the ramp's ends. */
export const ACCENT_VS: Record<1 | 2, string> = {
  1: '#4C6FE0',
  2: '#E86A2C',
}

/**
 * Frame geometry.
 *
 * Rule widths are CSS pixels rather than fractions of anything, because a rule
 * is a hairline at every screen size or it is not a rule. They reach the canvas
 * through `snapSize`, which rounds them to a whole device pixel.
 */
export const FRAME = {
  /** Box rules around a pane or the buffer. */
  rulePx: 1,
  /** Key caps carry a heavier rule than panes, so a target reads as a target. */
  capRulePx: 2,
  /** Padding either side of a title cut into a top rule, in character advances. */
  padChars: 1,
  /** The shaded rule on a block, as a fraction of a cell. */
  cellRuleFrac: 0.09,
  /** A locked cell's lit top and left edges. */
  highlightMix: 0.3,
  /** A locked cell's shaded bottom and right edges. */
  skirtMix: 0.42,
  /** The additive phosphor pass. See `withGlow`. */
  glowAlpha: 0.28,
  /** How far the glow pass oversizes what it sits under, in rule widths. */
  glowSpread: 1.4,
} as const

/** Rules the player feels but never reads. */
export const RULES = {
  /** Seconds a grounded piece rests before it locks. */
  lockDelay: 0.5,
  /** Pieces shown ahead of the one in play. */
  nextCount: 5,
  /**
   * Cells a piece is nudged down by on spawn, so it enters the visible buffer
   * immediately rather than appearing to hang above it.
   */
  spawnDrop: 1,
} as const

/**
 * Auto-shift timings for the movement buttons, in seconds.
 *
 * `delay` is how long a hold reads as a single step before it becomes a slide,
 * and `interval` is the slide's rate. Tuned for glass rather than for keys: a
 * finger cannot tap as fast as it can hold, so the delay is short enough that
 * holding is the natural way to cross the buffer.
 */
export const DAS = {
  delay: 0.17,
  interval: 0.04,
} as const

/** Animation lengths in seconds, and the amplitudes they drive. */
export const ANIM = {
  /** A row holds its flash before the stack collapses onto it. */
  clearFlash: 0.16,
  clearCollapse: 0.14,
  /** A hard-dropped piece squashes on impact. */
  landSquash: 0.07,
  landRecover: 0.12,
  /** Banner words: FLUSH, TWIST, the level number. */
  banner: 0.7,
  bannerHold: 0.35,
  scoreCount: 0.3,
  /** Local shake on the buffer, in world units at one cleared row. */
  shakePerRow: 2.4,
  /** The whole-screen fringe, reserved for a flush or a twist. */
  pulseAmount: 0.008,
  pulseDuration: 0.42,
  /** The fringe never fully settles, so the screen reads as a live monitor. */
  pulseBaseline: 0.0012,
  /** One full cycle of the shared cursor blink. */
  blink: 1.06,
} as const

/** Backdrop gradient stops, in the order `GradientBackgroundNode` wants them. */
export const GRADIENT = {
  topLeft: COLORS.backdropTop,
  bottomRight: COLORS.backdropBottom,
} as const

/** A locked cell's lit top and left edges. */
export function pieceHighlight(kind: PieceKind): string {
  return mixColor(PIECE_COLORS[kind], COLORS.white, FRAME.highlightMix)
}

/** A locked cell's shaded bottom and right edges. */
export function pieceSkirt(kind: PieceKind): string {
  return mixColor(PIECE_COLORS[kind], '#000000', FRAME.skirtMix)
}

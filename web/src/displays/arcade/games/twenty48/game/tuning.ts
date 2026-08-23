/**
 * All of 2048's tunable knobs in one place: palette, the tile ramp, the
 * extrusion geometry, rules, gesture thresholds and animation timings. Geometry
 * is expressed as fractions of the cell size wherever possible so the board
 * scales to whatever bounds the arcade region gives it.
 *
 * `meta.ts` seeds the game's `themeTokens` from these same constants. The
 * canvas is a sibling of the themed container and cannot read the custom
 * properties back, so one module feeding both surfaces is what keeps the DOM
 * chrome and the board in step.
 */
import { mixColor, parseColor, withAlpha } from '@src/stargazer'
import { prefersDarkInk, type Rgba } from '../../../background/palette'
import type { PlayerId } from './types'

/**
 * The dark ink. Deeper than the original's `#776E65`, which is the one place
 * this palette knowingly parts company with it: the classic ramp puts white
 * numerals on the orange tiles, and white does not clear AA on ANY step of that
 * ramp (it peaks at 2.96 against the 64 tile). One dark ink clears every step
 * with room to spare, so that is what the numerals use. See `tuning.test.ts`.
 */
const INK = '#4A4038'

/** The classic warm palette. */
export const COLORS = {
  /** Behind everything, and the top color of the region gradient. */
  background: '#FAF8EF',
  /** Bottom color of the region gradient, a shade warmer. */
  backgroundLow: '#F1E9DC',
  /** The board slab the wells are cut into. */
  plate: '#BBADA0',
  /** An empty cell. */
  well: '#CDC1B4',
  ink: INK,
  /** Softer ink for secondary copy, the original's numeral color. */
  inkSoft: '#776E65',
  /** Numerals on a fill too dark for {@link COLORS.ink}. */
  inkLight: '#F9F6F2',
  white: '#FFFFFF',
} as const

/**
 * Tile fills by exponent, so `TILE_COLORS[1]` is the 2 tile. Beyond 2048 the
 * ramp clamps to its last entry, which is why {@link tileColor} exists rather
 * than indexing this directly.
 */
export const TILE_COLORS: readonly string[] = [
  '#EEE4DA', // unused (2^0), keeps the index equal to the exponent
  '#EEE4DA', // 2
  '#EDE0C8', // 4
  '#F2B179', // 8
  '#F59563', // 16
  '#F67C5F', // 32
  '#F65E3B', // 64
  '#EDCF72', // 128
  '#EDCC61', // 256
  '#EDC850', // 512
  '#EDC53F', // 1024
  '#EDC22E', // 2048
]

/** Anything past 2048, where the warm ramp has nowhere left to go. */
const BEYOND = '#3C3A32'

/** Exponent of `value`, so `exponentOf(8)` is 3. */
export function exponentOf(value: number): number {
  return Math.round(Math.log2(value))
}

/** Fill for a tile of `value`, clamped past the end of the ramp. */
export function tileColor(value: number): string {
  const e = exponentOf(value)
  return e >= TILE_COLORS.length ? BEYOND : TILE_COLORS[e]
}

/** A css color as the `[r, g, b, a]` the luminance helpers take. */
function toRgba(css: string): Rgba {
  const c = parseColor(css)
  return [c.r * 255, c.g * 255, c.b * 255, c.a]
}

const INK_RGBA = toRgba(INK)
const INK_LIGHT_RGBA = toRgba('#F9F6F2')

/**
 * Numeral color for a tile of `value`: whichever ink actually reads better on
 * that fill. Measured rather than thresholded, so extending the ramp cannot
 * silently leave a step with unreadable numerals. In practice the warm ramp
 * takes the dark ink throughout and only the past-2048 tile flips.
 */
export function tileInk(value: number): string {
  const fill = toRgba(tileColor(value))
  return prefersDarkInk(fill, INK_RGBA, INK_LIGHT_RGBA)
    ? COLORS.ink
    : COLORS.inkLight
}

/** Top face lightened for the bevel highlight. */
export function tileHighlight(value: number): string {
  return mixColor(tileColor(value), COLORS.white, BEVEL.highlightMix)
}

/** The extruded side, darkened so the slab reads as solid. */
export function tileSkirt(value: number): string {
  return mixColor(tileColor(value), '#000000', BEVEL.skirtMix)
}

/**
 * Per-seat accents for versus. The tile ramp is shared by both boards, so the
 * seats are told apart by their frame and their labels instead. Warm against
 * cool, both at home in the beige.
 */
export const ACCENT_VS: Record<PlayerId, string> = {
  1: '#C0392B',
  2: '#2E7D7B',
}

/** The solo accent, matching the 32 step of the ramp. */
export const ACCENT_SOLO = '#F67C5F'

/**
 * The faux-3D construction. One fixed light from the top-left and a
 * near-straight-down view, so depth is a pure downward extrusion with no
 * horizontal skew. Everything here is hard-edged: there are no blurs anywhere
 * in this game.
 */
export const BEVEL = {
  /** Corner radius as a fraction of the cell. Generous, on everything. */
  radiusFrac: 0.24,
  /** Extrusion of the 2 tile, as a fraction of the cell. */
  baseDepthFrac: 0.055,
  /** Extra extrusion per doubling, so a 2048 tile visibly towers. */
  perStepDepthFrac: 0.011,
  /** Cap, so the tallest tile still clears the one below it. */
  maxDepthFrac: 0.16,
  /** Width of the top-left highlight band, as a fraction of the cell. */
  bandFrac: 0.045,
  /** How far the highlight is mixed toward white. */
  highlightMix: 0.28,
  /**
   * How far the extruded side is mixed toward black. Deep enough that the edge
   * reads against the well on the two pale steps of the ramp, where a lighter
   * mix all but disappeared.
   */
  skirtMix: 0.39,
  /** Depth of an empty well, drawn inverted so it reads as recessed. */
  wellDepthFrac: 0.03,
} as const

/** Extrusion depth in world units for a tile of `value` at this `cell` size. */
export function tileDepth(cell: number, value: number): number {
  const steps = Math.max(0, exponentOf(value) - 1)
  const d = BEVEL.baseDepthFrac + BEVEL.perStepDepthFrac * steps
  return cell * Math.min(d, BEVEL.maxDepthFrac)
}

/** Rules of play. */
export const RULES = {
  /** Tiles dealt at the start of a run. */
  startTiles: 2,
  /** Chance a spawned tile is a 4 rather than a 2. */
  fourChance: 0.1,
  /** The tile that triggers the win moment. Play continues past it. */
  winValue: 2048,
  /**
   * Merges at or above this fire a burst, so in practice every merge does. A
   * board that only reacts once you are deep into a run spends most of the game
   * feeling inert, and the confetti is cheap.
   */
  burstFrom: 4,
  /**
   * New highests at or above this get the milestone ring and a screen pulse.
   * Set low for the same reason, and it is a new HIGHEST rather than any merge,
   * so it still only fires about once per doubling.
   */
  milestoneFrom: 8,
} as const

/**
 * The shards a merge throws out. Speeds and sizes are multiples of the cell, so
 * a versus board's smaller tiles throw proportionally smaller confetti.
 */
export const BURST = {
  /** Launch speed range, in cells per second. */
  minSpeed: 0.32,
  maxSpeed: 0.8,
  /** Exponential drag. Lower drifts for longer. */
  dampingPerSec: 1.5,
  /** Below this a shard has effectively stopped and its slot is recycled. */
  stopSpeed: 7,
  /** Shard size range, as fractions of the cell. */
  minSize: 0.03,
  maxSize: 0.065,
  /** Peak spin, radians per second, in either direction. */
  spin: 6,
  /** Shards per burst at the smallest merge, and the cap. */
  baseCount: 6,
  maxCount: 22,
} as const

/**
 * The goal moment, which has to out-class the milestones that now fire from 8
 * upward. Where a milestone is one ring on one cell, this is the whole board
 * reacting: every tile pops in a wave rolling out from the winning one, and
 * confetti rains down over the plate.
 */
export const GOAL = {
  /** Delay added per cell of distance from the winning tile, in seconds. */
  cascadeStepSec: 0.045,
  /** Shards in the rain. */
  rainCount: 90,
  /** How long shards keep being released, in seconds. */
  rainDurationSec: 1.1,
  /** Downward acceleration on a shard, in cells per second squared. */
  rainGravity: 5.5,
  /** Initial downward speed range, in cells per second. */
  rainMinSpeed: 0.4,
  rainMaxSpeed: 1.2,
  /** Sideways drift at release, in cells per second, either way. */
  rainDrift: 0.5,
  /** Shard size range, as fractions of the cell. */
  rainMinSize: 0.035,
  rainMaxSize: 0.08,
  /** How far above the plate shards are released, as a fraction of its height. */
  rainStartAbove: 0.12,
} as const

/** Swipe thresholds. */
export const GESTURE = {
  /** Travel needed before a drag counts as a swipe, as a fraction of a cell. */
  minDistanceFrac: 0.35,
} as const

/** Animation timings in seconds, and the motion feel. */
export const ANIM = {
  /** A tile's slide to its destination. */
  slide: 0.1,
  /** Vertical squash on landing, as a fraction. */
  landSquash: 0.06,
  /** How long the landing squash takes to recover. */
  landRecover: 0.11,
  /** The merge pop's scale peak. */
  popScale: 1.18,
  /** The merge pop, out and back. */
  pop: 0.18,
  /** A freshly spawned tile scaling up. */
  spawn: 0.14,
  /** The "+N" rising off a merge. */
  floatScore: 0.55,
  /** How far the "+N" rises, in world units. */
  floatRise: 40,
  /** The milestone ring expanding. */
  milestone: 0.7,
  /** How long the milestone numeral is held before it fades. */
  milestoneHold: 0.5,
  /** The score readout counting up to a new value. */
  scoreCount: 0.3,
  /** A board's veil fading in when it goes out. */
  veilFade: 0.25,
  /** New highests at or above this pulse the whole screen, in solo only. */
  caPulseFrom: 8,
  /** Peak chromatic aberration of that pulse. */
  caAmount: 0.007,
  /** How long a whole-screen pulse lasts. */
  caPulse: 0.45,
} as const

/** The region gradient, dark enough to sit the plate on. */
export const GRADIENT = {
  topLeft: COLORS.background,
  bottomRight: COLORS.backgroundLow,
} as const

/** A translucent ink, for veils and dividers. */
export function inkAlpha(alpha: number): string {
  return withAlpha(COLORS.ink, alpha)
}

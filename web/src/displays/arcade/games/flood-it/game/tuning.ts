/**
 * Every tunable knob for Flood It: the board presets, the palette, the cell
 * glyphs, geometry fractions and animation timings.
 *
 * Geometry is expressed as fractions of the board or the cell wherever it can
 * be, so everything scales with the arcade region instead of being pinned to
 * one resolution. Timings are seconds of engine time, so a paused game holds.
 */
import { mixColor, withAlpha } from '@src/stargazer'
import type { PlayerId, PresetId } from './types'

/** One board-size choice. */
export interface Preset {
  cols: number
  rows: number
  colors: number
  /**
   * Move allowance as a multiple of the greedy solver's count. At 1 a player
   * has to match greedy, above it they have room to be worse.
   */
  slack: number
  /** Deals whose greedy par falls outside this band are rejected and redealt. */
  parMin: number
  parMax: number
}

/**
 * The three presets. Color count is the real difficulty lever here, far more
 * than grid size, so it climbs with the board and the slack tightens
 * alongside.
 *
 * The par bands are measured, not chosen: they are the middle of what
 * {@link greedySolve} actually produces for each grid and color count, narrow
 * enough to cut the outlier deals and wide enough that a deal is usually
 * accepted first try.
 */
export const PRESETS: Record<PresetId, Preset> = {
  small: { cols: 10, rows: 10, colors: 4, slack: 1.3, parMin: 11, parMax: 15 },
  medium: {
    cols: 14,
    rows: 14,
    colors: 5,
    slack: 1.18,
    parMin: 19,
    parMax: 24,
  },
  large: { cols: 18, rows: 18, colors: 6, slack: 1.08, parMin: 30, parMax: 37 },
}

/**
 * The cell colors, ordered so that taking the first N stays as separable as N
 * colors can be. A preset using four gets red, blue, yellow and green rather
 * than four neighbouring warms, and orange only joins at six where it sits
 * closest to red.
 */
export const CELL_COLORS = [
  '#E8465A',
  '#3D9BE9',
  '#F5D547',
  '#4FBF73',
  '#A86FD9',
  '#F2913D',
] as const

/**
 * A shape drawn inside every cell of its color, and on that color's button.
 *
 * Six hues cannot be told apart by everyone, and at five or six the usual
 * palettes lose a pair under the common color vision deficiencies. The glyphs
 * carry the same information in a channel that does not depend on hue at all.
 * Indices line up with {@link CELL_COLORS}.
 */
export type GlyphKind =
  'circle' | 'triangle' | 'square' | 'diamond' | 'chevron' | 'plus'

export const CELL_GLYPHS: readonly GlyphKind[] = [
  'circle',
  'triangle',
  'square',
  'diamond',
  'chevron',
  'plus',
]

/** Deep navy chrome, so the board is the only saturated thing on screen. */
const INK = '#0B0F1C'
const PAPER = '#EEF1FA'

export const COLORS = {
  ink: INK,
  paper: PAPER,
  /** Backdrop gradient behind the board, corner to corner. */
  backdropTop: '#1B2340',
  backdropBottom: '#0D1222',
  /** The recess the cells sit in. */
  well: '#080B15',
  /** Unowned cells dim to this on a loss. */
  dim: withAlpha(INK, 0.55),
} as const

/** How far the glyph ink is pushed toward the ink, over its own cell color. */
const GLYPH_INK_MIX = 0.55

/**
 * Glyph ink per cell color, opaque.
 *
 * A translucent ink cannot be used here. Several glyphs are drawn in more than
 * one pass, and where those passes overlap a translucent color blends twice, so
 * the seam between the two strokes of a chevron or the two bars of a plus shows
 * as a darker patch. Mixing the ink against the cell color up front gives the
 * same appearance in one opaque draw with nothing to double-blend. Computed
 * once at module load, so nothing here allocates per frame.
 */
export const GLYPH_INKS: readonly string[] = CELL_COLORS.map((color) =>
  mixColor(color, INK, GLYPH_INK_MIX),
)

/** Per-player accents. Neither hue appears in {@link CELL_COLORS}. */
export const ACCENT: Record<PlayerId, string> = {
  1: '#2DD4BF',
  2: '#FF4D9D',
}

/** The single-player accent, matching player 1 so the look carries over. */
export const ACCENT_SOLO = ACCENT[1]

/** Geometry, as fractions of the thing they sit inside. */
export const GEOM = {
  /** Gap between cells, as a fraction of the cell pitch. */
  cellGapFrac: 0.08,
  /** Cell corner radius, as a fraction of the drawn cell size. */
  cellRadiusFrac: 0.24,
  /** Well padding around the cells, as a fraction of the cell pitch. */
  wellPadFrac: 0.5,
  /** Well corner radius, as a fraction of the cell pitch. */
  wellRadiusFrac: 0.7,
  /**
   * Stroke width of the line around an owned region, as a fraction of the cell
   * pitch. Must stay under {@link GEOM.cellGapFrac}: the line runs along the
   * pitch grid, so anything wider spills out of the gap and onto the tiles.
   */
  outlineFrac: 0.042,
  /** Swatch corner radius, as a fraction of the swatch height. */
  swatchRadiusFrac: 0.26,
  /** Gap between swatches, as a fraction of swatch height. */
  swatchGapFrac: 0.16,
  /** Glyph extent inside a cell, as a fraction of the drawn cell size. */
  glyphFrac: 0.44,
  /** Glyph stroke width for the open glyphs, as a fraction of glyph extent. */
  glyphStrokeFrac: 0.26,
} as const

/** Animation timings, in seconds of engine time. */
export const ANIM = {
  /** One cell's crossfade from its old color to the new one. */
  floodFlip: 0.16,
  /** Longest delay between one wave depth and the next. */
  staggerMax: 0.03,
  /**
   * Ceiling on a whole flood, delays included. A board-spanning move would drag
   * at a fixed per-depth delay, so the stagger is derived from this instead:
   * small floods ripple, large ones stay snappy, and the knob a designer
   * reaches for is how long a move may take.
   */
  floodDurationCap: 0.42,
  /** Newly taken cells scale up from this, so a capture reads as a capture. */
  absorbScaleFrom: 0.55,

  /** Per-cell fade as a fresh board is dealt. */
  dealFlip: 0.2,
  /** Ceiling on the whole deal-in sweep. */
  dealDurationCap: 0.55,

  /** Swatch scale-down while held. */
  swatchPress: 0.07,
  /** Ring thrown by the chosen swatch. */
  swatchRing: 0.34,

  /** Move counter scale pop per tick. */
  counterPop: 0.18,
  /** Remaining moves at or below which the counter warns. */
  lowMovesWarn: 3,
  /** Counter breathing period once it is warning. */
  counterBreathe: 1.1,

  /** Whole-board celebration sweep on a win. */
  winPulse: 0.7,
  /** Unowned cells dimming on a loss. */
  lossDim: 0.4,
  /** Hold after the board settles before the result card opens. */
  resultHold: 0.7,
  /** Extra beat after a flood settles before the turn passes. */
  turnHandoffPad: 0.12,
  /** Glyph overlay fading in or out. */
  glyphFade: 0.22,
} as const

/** Longest a flood can take at `maxDepth`, delays included. */
export function floodDuration(maxDepth: number): number {
  return maxDepth * floodStagger(maxDepth) + ANIM.floodFlip
}

/**
 * Delay between consecutive wave depths, scaled so a deep wave still lands
 * inside {@link ANIM.floodDurationCap}.
 */
export function floodStagger(maxDepth: number): number {
  if (maxDepth <= 0) return 0
  const budget = (ANIM.floodDurationCap - ANIM.floodFlip) / maxDepth
  return Math.min(ANIM.staggerMax, Math.max(0, budget))
}

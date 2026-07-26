/**
 * World-unit and timing knobs for Connect Four. The board sizes itself to the
 * arcade game bounds (see the session), so geometry here is mostly fractions of
 * the cell size and gaps, not absolute sizes. Colors carry the game's sci-fi
 * palette (purple vs green).
 */
import type { Difficulty, Player } from './types'

/** Disc fill per player. 1 = purple (left), 2 = green (right / AI). */
export const PLAYER_COLORS: Record<Player, string> = {
  1: '#8F74E7',
  2: '#41AB8E',
}

/**
 * Lighter shade a winning line's discs recolor to, so the win reads at a
 * glance.
 */
export const WIN_GLOW: Record<Player, string> = {
  1: '#AB9CEE',
  2: '#50CEAB',
}

/** The game view's full-bleed gradient, top-left → bottom-right. */
export const BACKGROUND = {
  topLeft: '#A9B4BB',
  bottomRight: '#D2D6D9',
} as const

/**
 * The board panel and its slots. The panel is a light translucent sheet with a
 * single rounded corner (top-right); each slot is a subtly darker "well" with a
 * faint X behind it that a dropped chip covers.
 */
export const BOARD = {
  /** Radius of the one rounded corner (top-right), in world units. */
  cornerRadius: 40,
  /** Panel fill: light, translucent, reads over the gray gradient. */
  bg: 'rgba(238, 241, 244, 0.5)',
  /** Slot well radius as a fraction of the cell (a touch larger than a chip). */
  wellRadiusFrac: 0.4,
  /**
   * Slot well fill: subtly darker than the panel, so a ring shows around a
   * chip.
   */
  wellFill: 'rgba(120, 133, 148, 0.22)',
  /** Chip radius as a fraction of the cell (smaller than the well). */
  discRadiusFrac: 0.34,
  /** Faint slot X: arm half-length as a fraction of the cell (< chip radius). */
  xArmFrac: 0.15,
  /** Slot X stroke color (faint). */
  xColor: 'rgba(140, 151, 164, 0.35)',
  /** Slot X stroke width in CSS pixels. */
  xWidth: 2.5,
} as const

/** Sketch-like registration marks at the board corners. */
export const FRAME = {
  color: 'rgba(255, 255, 255, 0.85)',
  /** Stroke width in CSS pixels. */
  width: 2,
  /** Corner-bracket arm length in world units. */
  arm: 64,
  /** How far each bracket overshoots past its corner, in world units. */
  overshoot: 22,
  /** Technical labels drawn vertically at two corners. */
  labelColor: 'rgba(255, 255, 255, 0.8)',
  /** Label font size in CSS pixels. */
  labelSizePx: 22,
  labelFont: 'ui-monospace, "SF Mono", Menlo, monospace',
  topLeftLabel: '0.0.0.4',
  bottomRightLabel: 'cnntc_4',
} as const

/** The purple/green pill above the board marking the active drop column. */
export const PILL = {
  /** Width / height as fractions of the cell. */
  widthFrac: 0.5,
  heightFrac: 0.16,
  /** Vertical offset above the board top edge, in cells. */
  yOffsetFrac: 0.4,
} as const

/** The p.1 / p.2 side tabs. Sizes are fractions of the cell so they scale. */
export const TAB = {
  widthFrac: 1.6,
  heightFrac: 1.7,
  /** The one rounded corner's radius, as a fraction of the tab width. */
  cornerRadiusFrac: 0.24,
  /** Winner's folded corner size, as a fraction of the tab width. */
  dogEarFrac: 0.26,
  /** Gap from the panel edge, in cells. */
  gapFrac: 0.55,
  /** Main "p.N" label: a bold sans (only the sublabel is monospace). */
  labelFont: 'system-ui, "Segoe UI", Roboto, sans-serif',
  /** "your turn" / "won" sublabel font (monospace, technical feel). */
  subFont: 'ui-monospace, "SF Mono", Menlo, monospace',
} as const

/** Square particle trail behind a falling chip. */
export const TRAIL = {
  capacity: 40,
  ratePerSec: 130,
  lifetimeSec: [0.12, 0.24] as const,
  /** Square size range as fractions of the cell. */
  sizeFrac: [0.05, 0.09] as const,
  speedWorld: [8, 34] as const,
  spreadRad: 0.5,
  dampingPerSec: 3,
} as const

/** Win celebration: the connecting line, per-chip node marks, and the burst. */
export const WIN = {
  lineColor: '#ffffff',
  /** Line width in CSS pixels. */
  lineWidth: 3,
  /** Node ring / dot radii as fractions of the cell. */
  ringRadiusFrac: 0.16,
  dotRadiusFrac: 0.05,
  ringColor: '#ffffff',
  ringWidth: 2,
  /** Square burst per winning cell, scaled off the disc radius. */
  burst: {
    countBase: 12,
    countPerRadius: 0.25,
    speedMinPerRadius: 5,
    speedMaxPerRadius: 11,
    dampingPerSec: 2.4,
    spinMaxRadPerSec: 9,
    /** Square side length, as a fraction of the disc radius. */
    sizePerRadius: 0.5,
    /** Fraction of a piece's own launch speed below which it despawns. */
    minSpeedFrac: 0.02,
    /**
     * Safety cap on lifetime (seconds); pieces normally despawn sooner via
     * `minSpeedFrac`.
     */
    lifetimeSecMax: 3,
  },
} as const

/** AI search depth and blunder rate per difficulty (see the stargazer AI guide). */
export const AI_LEVELS: Record<
  Difficulty,
  { depth: number; blunderChance: number }
> = {
  easy: { depth: 2, blunderChance: 0.3 },
  medium: { depth: 4, blunderChance: 0 },
  hard: { depth: 7, blunderChance: 0 },
}

/** Animation timings (seconds). */
export const ANIM = {
  /**
   * Base drop time plus per-row travel, so a longer fall takes longer. Covers
   * the whole sequence — the accelerating fall and the bounces after it — so it
   * needs enough room for both to read clearly.
   */
  dropBase: 0.34,
  dropPerRow: 0.07,
  /** Board fade-in on match start. */
  revealOpen: 0.4,
  /** Board fade-out when returning to the main screen. */
  foldClose: 0.3,
  /** Winning-line pulse before the burst. */
  winPulse: 0.5,
  /** Win line draw-on. */
  winLineDraw: 0.45,
  /** Per-chip node-mark pop. */
  winMarkPop: 0.25,
  /** Player-tab flip to the win state. */
  tabFlip: 0.3,
  /** Hold on the result before folding back to the main screen. */
  winHold: 2.0,
  /** Pause before the AI plays, so its move reads as a decision. */
  aiThinkDelay: 0.45,
} as const

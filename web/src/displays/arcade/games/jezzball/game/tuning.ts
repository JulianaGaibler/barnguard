/**
 * All tunable knobs for JezzBall in one place: palette, grid, physics feel,
 * level pacing, scoring weights, gesture thresholds, and animation timings.
 * Geometry is expressed in fractions where possible so the board scales to the
 * arcade bounds; absolute values are world units unless noted.
 */
import type { PlayerId } from './types'

/** Grid resolution. Square by default; both configurable. */
export const GRID = {
  cols: 20,
  rows: 20,
} as const

/**
 * Palette. Monochrome base with a single accent in one-player, and per-player
 * accents in two-player. Each accent has a `primary` (one wall side, progress
 * bar) and a `variant` (the other wall side).
 */
export const COLORS = {
  /** Page background behind everything. */
  background: '#DEDEDE',
  /** The single dark ink: border frame, text, decorations, the ball. */
  ink: '#272727',
  /** Playfield background (near-white). */
  field: '#F2F2F2',
  /** Thin grid line over the field. */
  gridLine: 'rgba(39, 39, 39, 0.09)',
  /** Captured-region overlay (darker gray, grid still reads through). */
  captured: 'rgba(39, 39, 39, 0.26)',
  /** White, used in the accent mix (heart fills, progress track). */
  white: '#FFFFFF',
  /** Empty heart / inactive slot. */
  slotEmpty: 'rgba(39, 39, 39, 0.22)',
} as const

/** One-player accent (primary wall side + progress bar / variant wall side). */
export const ACCENT_SOLO = { primary: '#D61D5F', variant: '#C31050' } as const

/** Two-player accents, keyed by board. P1 purple, P2 blue. */
export const ACCENT_VS: Record<PlayerId, { primary: string; variant: string }> =
  {
    1: { primary: '#B106C7', variant: '#6E0D64' },
    2: { primary: '#026BE2', variant: '#073797' },
  }

/** Shared pink used for progress "of 75%" marker in both modes. */
export const PROGRESS_ACCENT = '#D61D5F'

/** Fixed-step period the physics world advances at (matches the engine). */
export const FIXED_DT = 1 / 120

/**
 * Physics feel. Balls are perfectly elastic, never sleep, and are renormalized
 * to a constant speed each frame. `SAFETY` bounds `BALL_SPEED` against the ball
 * radius so a ball can't tunnel a solid in one fixed step (the engine's dynamic
 * step is discrete, no CCD). See `tuning.test.ts`.
 */
export const PHYSICS = {
  /** Constant ball speed (world units/second). */
  ballSpeed: 460,
  /** Ball radius as a fraction of the cell size. */
  ballRadiusFrac: 0.34,
  /** Speed the two wall segments extend at (world units/second). */
  wallGrowSpeed: 1150,
  restitution: 1,
  friction: 0,
  /** 1 = no damping (the engine only damps when this differs from 1). */
  linearDamping: 1,
  /** Displacement/step must stay under `ballRadius * safety`. */
  tunnelSafety: 0.6,
  /** Backstop cap multiple of `ballSpeed`, set as the world's maxLinearSpeed. */
  maxSpeedMultiple: 1.5,
} as const

/**
 * The smallest board side (world units) the invariant test evaluates against —
 * roughly the one-player landscape board (region height minus frame/padding).
 * Real boards are usually larger, so this is the worst case for tunneling.
 */
export const REF_BOARD_SIDE = 940

/** Level pacing and lives. Hearts UI shows up to `maxLivesDisplay` slots. */
export const RULES = {
  startBalls: 2,
  ballsPerLevel: 1,
  startLives: 5,
  livesPerLevel: 1,
  maxLivesDisplay: 10,
  /** Percentage of the arena that must be captured to clear a level. */
  targetPct: 75,
} as const

/** Scoring weights (see `session.ts` for how each is applied). */
export const SCORING = {
  /** Points per captured cell (grid-elimination component). */
  cellPoints: 1,
  /** Bonus points per percentage point captured beyond the target. */
  fillBonusPerPct: 5,
  /** Time-bonus starting value at level start. */
  timeBonusBase: 500,
  /** Time-bonus decay per second elapsed in the level. */
  timePenaltyPerSec: 5,
  /** Points per remaining life (level clear, game over, MP survivor). */
  lifeValue: 50,
} as const

/** Two-finger gesture thresholds. */
export const GESTURE = {
  /** Minimum finger separation (world units) for a valid gesture. */
  minSpan: 44,
  /** Maximum finger separation (world units). */
  maxSpan: 380,
  /**
   * Half-width of the orientation acceptance band, in degrees. Fingers within
   * this of horizontal → horizontal wall, within this of vertical → vertical
   * wall; the ambiguous diagonal band between builds nothing.
   */
  angleTolDeg: 28,
  /** Frames both fingers must persist before a wall spawns (debounce). */
  stableFrames: 3,
} as const

/** Animation timings (seconds) and geometry fractions. */
export const ANIM = {
  /** Black frame thickness as a fraction of the board side. */
  borderFrac: 0.04,
  /** Grid line width (screen pixels, constant on screen). */
  gridLineWidth: 1,
  /** Wall thickness as a fraction of the cell (1 = full cell). */
  wallThicknessFrac: 0.9,
  /** Captured region flood-reveal duration. */
  floodReveal: 0.5,
  /** Brief flash when a wall solidifies. */
  solidifyFlash: 0.18,
  /** Heart pop/fade when a life is lost. */
  heartLoss: 0.4,
  /** Stage count-in (whole seconds counted down from this). */
  countdownFrom: 3,
  /** Hold on the level-clear celebration before advancing. */
  levelClearHold: 1.6,
  /** Progress bar fill tween. */
  progressTween: 0.45,
  /** Decorative 90° rotation duration (corners, LVL/PTS motif). */
  decorRotate: 0.5,
  /** Idle interval between ambient corner rotations. */
  decorIdleInterval: 6,
} as const

/** Ball radius in world units for a given cell size. */
export function ballRadiusWorld(cell: number): number {
  return cell * PHYSICS.ballRadiusFrac
}

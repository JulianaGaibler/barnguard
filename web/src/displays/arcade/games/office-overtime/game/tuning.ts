// Every tunable number for Office Overtime. Colours here are literal hex: the
// canvas parser accepts only hex and rgb()/rgba(), and silently paints anything
// else black, so `color-mix()` belongs in `meta.ts` (CSS) and never here.

import { DEFAULT_WEIGHTS, type Weights } from './evaluate'

/** How hard the computer opponent plays. */
export type Difficulty = 'easy' | 'medium' | 'hard'

export interface SearchConfig {
  /** Plies of lookahead. 1 is the immediate move only. */
  depth: number
  /** How many candidates survive at each of the AI's own plies. */
  beam: number[]
  /** Deck shuffles sampled per decision. Only matters past one ply. */
  samples: number
  /** Deck shuffles sampled to value a redraw. */
  redrawSamples: number
  considerRedraw: boolean
  /** Average the score over every layout the org could still settle into. */
  expectedWindows: boolean
  /** Choose uniformly among this many best moves. 1 always takes the best. */
  topChoices: number
  /** Wall-clock ceiling for one decision. The search returns its best so far. */
  budgetMs: number
  weights: Weights
}

/**
 * The ladder.
 *
 * Weakness comes from playing a simpler game, not from throwing turns away. An
 * opponent that randomly blunders reads as broken rather than beatable, so easy
 * plays honest but myopic solitaire: one ply, no idea the other player exists,
 * and no sense that its org's shape is still unsettled.
 *
 * The steps are capability, not depth. Searching past two plies measurably does
 * not help, so the gaps are: easy cannot see the opponent, medium can but will
 * not spend an approval to redeal a bad row, and hard will. Redealing is worth
 * about four and a half points a game, which is the widest single lever there
 * is.
 */
export const AI_PROFILES: Record<Difficulty, SearchConfig> = {
  easy: {
    depth: 1,
    beam: [1],
    samples: 0,
    redrawSamples: 0,
    considerRedraw: false,
    expectedWindows: false,
    topChoices: 3,
    budgetMs: 60,
    weights: { ...DEFAULT_WEIGHTS, denial: 0 },
  },
  medium: {
    depth: 2,
    beam: [8],
    samples: 2,
    redrawSamples: 0,
    considerRedraw: false,
    expectedWindows: true,
    topChoices: 1,
    budgetMs: 500,
    weights: DEFAULT_WEIGHTS,
  },
  hard: {
    depth: 2,
    beam: [12],
    samples: 3,
    redrawSamples: 8,
    considerRedraw: true,
    expectedWindows: true,
    topChoices: 1,
    budgetMs: 900,
    weights: DEFAULT_WEIGHTS,
  },
}

/**
 * Search is synchronous, so it runs in slices and yields between them. A frame
 * is 16.7ms; anything approaching that steals time from in-flight tweens,
 * because a stall past `maxDt` is clamped and the smoothed timestep then runs
 * animations fast for several frames while it recovers.
 */
export const AI_SLICE_MS = 5

/**
 * Canvas colours. Literal hex only: the canvas parser accepts hex and
 * rgb()/rgba() and silently paints anything else black.
 */
export const COLORS = {
  backdropTop: '#f2ece1',
  backdropBottom: '#d9cdb8',
  /** Card stock, by floor. Carried over from the printed cards. */
  stockManagement: '#c6d6d4',
  stockIc: '#dcc2a2',
  /** The floor stripe down a card's edge. */
  ribbonManagement: '#8d9c9a',
  ribbonIc: '#a8825a',
  cardEdge: '#3a3129',
  cardShadow: '#00000022',
  ink: '#2b2620',
  inkSoft: '#6b6157',
  paper: '#fbf7ef',
  coin: '#f0c552',
  coinEdge: '#b08a2a',
  seal: '#c2402f',
  openSeat: '#b9ab95',
  slotEmpty: '#00000014',
  slotLegal: '#4a8f6a55',
  slotHover: '#4a8f6a99',
  activeSide: '#c2402f',
  approval: '#c2402f',
  budget: '#2f7d4f',
} as const

/** One colour per department, kept from the original faction shields. */
export const GROUP_COLORS = {
  leadership: '#42bfe4',
  people: '#7d2d7a',
  research: '#4f782a',
  product: '#cf4a2e',
  engineering: '#e8913c',
  design: '#bd8736',
} as const

/** Card face proportions, as fractions of the card's own width or height. */
export const CARD = {
  cornerFrac: 0.06,
  ribbonWidthFrac: 0.16,
  /**
   * The name runs down the ribbon reading top to bottom, as on the printed
   * cards, so it is turned a quarter turn clockwise. Screen Y points down, so
   * that is a positive angle: it carries the text advance direction (1, 0) onto
   * (0, 1). Negating it runs the name bottom to top, which reads as though the
   * ribbon were flipped end for end.
   */
  nameRotation: Math.PI / 2,
  /** The name starts below the cost coin and runs to near the ribbon's tail. */
  ribbonTextTopFrac: 0.26,
  ribbonTextBottomFrac: 0.95,
  coinRadiusFrac: 0.17,
  shieldWidthFrac: 0.17,
  artTopFrac: 0.1,
  // The art is a placeholder, so the rules text gets the room. Both text bands
  // size themselves to fit rather than clipping: a card whose ability or review
  // is cut off cannot be reasoned about, which makes the game unreadable and
  // the opponent impossible to check.
  artBottomFrac: 0.46,
  abilityTopFrac: 0.48,
  abilityBottomFrac: 0.68,
  reviewTopFrac: 0.7,
  reviewBottomFrac: 0.96,
  /** Font sizes tried for the rules text, largest first, as fractions of width. */
  bodySizeFracs: [0.082, 0.074, 0.066, 0.058, 0.05, 0.044],
  /** Below this drawn width, only the coin, groups and name are drawn. */
  detailMinWidth: 150,
} as const

/** Table geometry, as fractions of the visible game rect where it varies. */
export const LAYOUT = {
  /** Portrait card, height over width. Matches the printed cards. */
  cardAspect: 1.4,
  /** Roughly the shape of a 3x3 of those cards. */
  orgAspect: 3 / (3 * 1.4),
  /** The centre column is wider: the candidates are what players read. */
  centerFlex: 1.25,
  padFrac: 0.03,
  gapFrac: 0.02,
  cellGapFrac: 0.03,
  slotGapFrac: 0.04,
  /** Left clear at the top so no drag starts in the launcher pull-down zone. */
  headerHeight: 96,
  markerHeight: 72,
  resourceBarHeight: 76,
} as const

export const ANIM = {
  /** Pause before the computer commits, so its turn reads as a decision. */
  aiThinkDelay: 0.45,
} as const

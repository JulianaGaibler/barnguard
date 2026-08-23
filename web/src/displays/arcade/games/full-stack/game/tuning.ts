// Every tunable number for Full Stack. The canvas parser accepts only hex
// and rgb()/rgba(), and silently paints anything else black, so a CSS form like
// `color-mix()` must not appear here. `mixColor` and `withAlpha` emit rgb() and
// rgba(), so shades built with them work in both the canvas and the DOM.

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
 * is 16.7ms, and anything approaching that steals time from in-flight tweens,
 * because a stall past `maxDt` is clamped and the smoothed timestep then runs
 * animations fast for several frames while it recovers.
 */
export const AI_SLICE_MS = 5

/**
 * Canvas colours. Literal hex only: the canvas parser accepts hex and
 * rgb()/rgba() and silently paints anything else black. These mirror the
 * designed card art. The DOM chrome duplicates the matching roles in `meta.ts`,
 * which is the established split.
 */
export const COLORS = {
  /**
   * The board behind everything. The design is flat, and a faint gradient reads
   * as paper.
   */
  backdropTop: '#f8f7f2',
  backdropBottom: '#f2f0e8',
  board: '#f7f6f0',
  /** Card stock, by floor. */
  stockManagement: '#eceaf0',
  stockIc: '#f7ede4',
  /** The 2px-equivalent black edge every card carries. */
  cardEdge: '#141210',
  cardShadow: '#00000026',
  ink: '#2b2620',
  inkSoft: '#6b6157',
  /** 25% ink, for the review divider. */
  dividerInk: '#2b262040',
  lanyard: '#f7f6f0',
  portraitDisc: '#3c3c3c',
  /** Cost coin: white disc, dark edge and number. */
  coinFill: '#ffffff',
  coinEdge: '#2f2f2f',
  coinInk: '#2f2f2f',
  /** Review band: a red points chip on a translucent white strip. */
  reviewChip: '#da3236',
  reviewChipInk: '#fcfcfa',
  reviewBand: '#ffffffbf',
  /** Open seat: light disc, generic person glyph. */
  openSeatStock: '#ffffff',
  openSeatDisc: '#eceaf0',
  personGlyph: '#faf5f3',
  personInk: '#3c3c3c',
  /** Empty org slots draw as light rounded placeholders. */
  slotEmpty: '#d9d9d9',
  slotLegal: '#4a8f6a55',
  slotHover: '#4a8f6a99',
  /** The active side's resource pill and turn cue. */
  activeSide: '#c2402f',
  /** Translucent fill of the active side's pill. */
  activePill: '#c2402f1f',
  approval: '#283f20',
  budget: '#6e4725',
  /** Controls and resource bars sit on a light panel. */
  panel: '#ffffff',
  panelBorder: '#2b262033',
  pressed: '#00000014',
  disabledText: '#b3ada2',
  /**
   * Board colour at 55%, laid over a whole card to fade it back. The effect it
   * stands in for is the card drawn at 45% over the table, so the veil takes
   * `board`, which sits between the two backdrop stops and so is within a level
   * or two of the table wherever a card lands on it.
   */
  fadeVeil: '#f7f6f08c',
  /** Points earned, over the dark portrait disc that holds them. */
  scoreInk: '#ffffff',
  /** Board wash behind a single card being explained. */
  scrim: '#2b2620a3',
} as const

/**
 * Per-department colours, read straight out of the icon SVGs: `ink` is the
 * badge ring, `fill` the badge disc, `panel` the art-panel tint. Leadership,
 * engineering and design panels come from the reference cards. The other three
 * are matched by hand (research and design deliberately differ despite a shared
 * badge fill, told apart by ink and glyph).
 */
export const GROUP_COLORS = {
  leadership: { ink: '#014461', fill: '#42bfe4', panel: '#a4dff0' },
  people: { ink: '#4c194e', fill: '#bc98b5', panel: '#dcc2d8' },
  research: { ink: '#283f20', fill: '#e7dc76', panel: '#d8dccb' },
  product: { ink: '#7a2e22', fill: '#e26037', panel: '#f9b79e' },
  engineering: { ink: '#7a2e22', fill: '#f5b472', panel: '#ffc891' },
  design: { ink: '#6e4725', fill: '#e7dc76', panel: '#e7dc76' },
} as const

/**
 * Table geometry. The row holds nine equal cards in three groups of three (org,
 * shortlists, org). The three groups sit on an even rhythm, one gap at each
 * edge and one between each pair, all the same width, so the table reads as
 * three columns on a grid rather than a pair of orgs pushed to the rails.
 * Height binds at 16:9, so the spare horizontal space is split across those
 * four gaps. Fractions are of the visible game rect unless noted.
 */
export const LAYOUT = {
  /** Portrait card, height over width. The reference card is 256x388. */
  cardAspect: 388 / 256,
  /**
   * Gap between the three cards inside one region, as a fraction of a card's
   * width. Keeping it relative to the card (not the view) is what lets an org
   * cell and a shortlist card come out the same width from an equal-width
   * region, which is the "nine equal cards across" constraint.
   */
  cardGapRatio: 0.07,
  /**
   * Smallest of the four equal horizontal gaps, being two outer margins and two
   * between the regions. Spare width is split evenly across all four.
   */
  columnGapMinFrac: 0.03,
  /**
   * Height kept clear at the top and bottom, so no drag starts in the launcher
   * hatch.
   */
  topReserveFrac: 0.075,
  /** Gap below an org before its resource bar. */
  resourceGapFrac: 0.018,
  /** Resource bar height. */
  resourceBarFrac: 0.058,
  /** Caption strip above each shortlist. */
  captionFrac: 0.034,
  /** Control stack below the shortlists. */
  controlFrac: 0.14,
} as const

export const ANIM = {
  /** Pause before the computer commits, so its turn reads as a decision. */
  aiThinkDelay: 0.45,
  /** A card flying from its seat to the middle of the help view. */
  helpFocus: 0.28,
  /** A card growing in where it was dealt, and the gap along a row. */
  dealIn: 0.26,
  dealStagger: 0.06,
  /** A card sliding off the shortlist on a redeal. */
  toss: 0.2,
  tossStagger: 0.04,
  /** Half a turn. The face swaps between the two halves. */
  flipHalf: 0.13,
  /** A tapped hire travelling from the shortlist to its seat. */
  travel: 0.3,
  /** A dragged hire, which is already at the seat, taking its weight. */
  settle: 0.12,
  /** The car travelling between the two floors. */
  elevator: 0.34,
  /** Gap between two beats of a computer turn. */
  beat: 0.22,
} as const

/**
 * The staff wall behind the menu.
 *
 * `cell` is a fraction of the view height, so the grid holds its density at any
 * size.
 */
export const MENU_WALL = {
  cell: 0.16,
  /** Fraction of the width the menu rail owns, which the wall stays clear of. */
  railShare: 0.4,
  /** Face size as a fraction of the smaller grid step, leaving the rest as air. */
  faceRatio: 0.88,
  /** Share of the cells holding somebody, which the swaps hold steady. */
  fill: 0.4,
  /** Seconds a face takes to arrive or to leave. */
  fade: 1.8,
  /** Seconds between one person starting to leave and the next arriving. */
  stagger: 0.7,
  /** Seconds the wall holds still between swaps. */
  rest: 1.5,
} as const

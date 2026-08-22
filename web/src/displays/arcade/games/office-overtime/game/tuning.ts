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
 * rgb()/rgba() and silently paints anything else black. These mirror the
 * designed art (`~/Desktop/office`); the DOM chrome duplicates the matching
 * roles in `meta.ts`, which is the established split.
 */
export const COLORS = {
  /**
   * The board behind everything. The design is flat; a faint gradient reads as
   * paper.
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
  lanyard: '#d9d9d9',
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
  /** Veil over a card the flip toggle would replace, or an inactive one. */
  dimVeil: '#00000033',
} as const

/**
 * Per-department colours, read straight out of the icon SVGs: `ink` is the
 * badge ring, `fill` the badge disc, `panel` the art-panel tint. Leadership,
 * engineering and design panels come from the reference cards; the other three
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
 * shortlists, org) with a wide gap between groups; height binds at 16:9, so the
 * spare horizontal space becomes that gap. Fractions are of the visible game
 * rect unless noted.
 */
export const LAYOUT = {
  /** Portrait card, height over width. The reference card is 256x388. */
  cardAspect: 388 / 256,
  padFrac: 0.03,
  /**
   * Gap between the three cards inside one region, as a fraction of a card's
   * width. Keeping it relative to the card (not the view) is what lets an org
   * cell and a shortlist card come out the same width from an equal-width
   * region, which is the "nine equal cards across" constraint.
   */
  cardGapRatio: 0.07,
  /** Smallest gap between the three regions; spare width is added to it. */
  regionGapMinFrac: 0.03,
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
} as const

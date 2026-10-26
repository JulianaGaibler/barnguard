/** Value types for the Full Stack session. */

import type { TextSpan } from 'stargazer'
import type { Difficulty } from './tuning'
import type { Card } from './rules/deck'

/** Board size: `standard` is the 3x3/9-seat org, `quick` the 2x2/4-seat one. */
export type BoardSize = 'standard' | 'quick'

export type GameMode =
  | { kind: 'versus'; size: BoardSize }
  | { kind: 'ai'; difficulty: Difficulty; size: BoardSize }

export type SessionState = 'idle' | 'playing' | 'gameOver'

export interface SideSummary {
  budget: number
  approvals: number
  seats: number
}

export interface ScoreLine {
  name: string
  points: number
  detail: string
}

export interface SideResultView {
  total: number
  approvals: number
  loose: number
  lines: ScoreLine[]
}

export interface GameOverView {
  sides: [SideResultView, SideResultView]
  winner: 0 | 1 | null
}

/** A pending human decision on a `choose` card, resolved by the overlay. */
export interface ChoicePrompt {
  card: Card
  /** The two (or more) options, each already turned into display spans. */
  options: TextSpan[][]
  /** Called with the chosen option index. The turn pipeline is awaiting it. */
  pick: (index: number) => void
  /** Back out of the hire entirely, leaving the candidate on the shortlist. */
  cancel: () => void
}

export interface GameEvents {
  matchStarted: { mode: GameMode }
  turnChanged: { turn: 0 | 1; thinking: boolean }
  sidesChanged: { sides: [SideSummary, SideSummary] }
  gameOver: GameOverView
  /** A human hired a card that offers a choice, which the overlay resolves. */
  choice: ChoicePrompt | null
  /** The card the player asked about, or null once the sheet is dismissed. */
  help: { card: Card } | null
  /** Whether taps explain a card instead of picking one. */
  helpMode: boolean
  reset: void
  paused: void
  resumed: void
}

/** Value types for the Office Overtime session. */

import type { TextSpan } from '@src/stargazer'
import type { Difficulty } from './tuning'
import type { Card } from './rules/deck'

export type GameMode =
  { kind: 'versus' } | { kind: 'ai'; difficulty: Difficulty }

export type SessionState = 'idle' | 'playing' | 'gameOver'

/** A seat the local player may place the selected candidate into. */
export interface SlotHint {
  row: number
  col: number
}

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
  /** Called with the chosen option index; the turn pipeline is awaiting it. */
  pick: (index: number) => void
}

export interface GameEvents {
  matchStarted: { mode: GameMode }
  turnChanged: { turn: 0 | 1; thinking: boolean }
  sidesChanged: { sides: [SideSummary, SideSummary] }
  gameOver: GameOverView
  /** A human hired a card that offers a choice; the overlay must resolve it. */
  choice: ChoicePrompt | null
  reset: void
  paused: void
  resumed: void
}

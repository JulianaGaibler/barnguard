/** Value types for the Office Overtime session, free of engine imports. */

import type { Difficulty } from './tuning'

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

export interface GameEvents {
  matchStarted: { mode: GameMode }
  turnChanged: { turn: 0 | 1; thinking: boolean }
  sidesChanged: { sides: [SideSummary, SideSummary] }
  gameOver: GameOverView
  reset: void
  paused: void
  resumed: void
}

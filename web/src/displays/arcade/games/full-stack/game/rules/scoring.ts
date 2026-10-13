// End-of-game scoring, plus the metric interpreter the whole rules layer shares.
//
// Every card is read through the `Metric` union, so there is no per-card logic
// anywhere in this file. `economy.ts` calls `countMetric` too, which is what
// makes an on-hire ability and a performance review agree on what "three
// Engineering badges" means.
//
// Pure and DOM-free. Alongside each card's points it emits a `ScoreDetail` that
// `text.ts` renders as a "count x points = result" line in the game-over
// breakdown.

import {
  ALL_GROUPS,
  type Card,
  type Condition,
  type Group,
  type Metric,
  type Region,
  type Area,
  type ScoringRule,
} from './deck'

/** An org always has nine seats, however few are filled so far. */
export const SEAT_COUNT = 9

/**
 * Which corner a 3x3 position bonus becomes on a 2x2 org, where every seat is a
 * corner and there is no middle or edge. Direction is kept where it can be: a
 * top bonus stays up, a left bonus stays left. The cards with no 2x2 analogue
 * (middle row/column, edge centre) are spread across the remaining corners so
 * they still reward a specific seat rather than any seat.
 */
const QUICK_CORNER: Partial<Record<Area, Area>> = {
  topRow: 'topLeft',
  bottomRow: 'bottomLeft',
  leftColumn: 'topLeft',
  rightColumn: 'topRight',
  corner: 'bottomRight',
  edgeCenter: 'bottomRight',
  middleRow: 'topRight',
  middleColumn: 'bottomLeft',
}

/**
 * Shrink a rule whose shape is too big for a 2x2 org. A run or matching-set of
 * three can never complete on four seats, so it drops to two, and a 3x3
 * position bonus becomes the single corner it maps to. Every other rule keeps
 * its shape; a card that also needs its points retuned carries an explicit
 * `quickScoring`.
 */
function shrinkScoring(rule: ScoringRule): ScoringRule {
  if (rule.score === 'perMatchingGroupSet' || rule.score === 'perRun') {
    return { ...rule, size: Math.min(rule.size, 2) }
  }
  if (rule.score === 'bonus' && rule.when.when === 'inArea') {
    const corner = QUICK_CORNER[rule.when.area]
    if (corner) return { ...rule, when: { when: 'inArea', area: corner } }
  }
  return rule
}

/**
 * The scoring rule in force for a card at this board size. Standard play always
 * uses the printed rule. Quick play prefers a hand-authored `quickScoring`, and
 * otherwise falls back to a mechanically shrunk rule.
 */
export function resolveScoring(card: Card, width: number): ScoringRule {
  if (width >= 3) return card.scoring
  return card.quickScoring ?? shrinkScoring(card.scoring)
}

/** A hired card, holding whatever budget has been moved onto it. */
export type FilledSeat = { card: Card; budget: number }

/** A seat left open scores nothing and contributes no groups. */
export type OpenSeat = { openSeat: true }

export type Cell = FilledSeat | OpenSeat | null

/**
 * Cells in row-major order. Nine cells once normalized for scoring, but wider
 * while the org is still being built (see `match.ts`).
 */
export type Grid = readonly (readonly Cell[])[]

/**
 * `width` is the org's side (3 standard, 2 Quick). Seat counts and the scored
 * grid are taken from it, not from the backing array, so an org held in a wider
 * working grid still scores against the right number of seats. Defaults to 3
 * wherever it is omitted, which keeps standard play and its callers unchanged.
 */
export type Player = { grid: Grid; approvals: number; width?: number }

/** The org's side, defaulting to the standard 3x3. */
const widthOf = (player: Player): number => player.width ?? 3

export type Pos = { r: number; c: number }

export const isOpenSeat = (cell: Cell): cell is OpenSeat =>
  cell !== null && 'openSeat' in cell

export const isFilled = (cell: Cell): cell is FilledSeat =>
  cell !== null && 'card' in cell

const isBudgetLine = (card: Card): boolean =>
  card.scoring.score === 'budgetLine'

/**
 * The cells a metric counts over. Open seats and unfilled cells never reach
 * `filled`, so a card left face down carries no groups, no floor and no
 * discount into any count.
 */
export type Scope = {
  filled: FilledSeat[]
  openSeats: number
  emptySeats: number
  approvals: number
}

function cellsFor(region: Region, pos: Pos, width: number): Pos[] {
  const all: Pos[] = []
  if (region === 'row') {
    for (let c = 0; c < width; c++) all.push({ r: pos.r, c })
  } else if (region === 'column') {
    for (let r = 0; r < width; r++) all.push({ r, c: pos.c })
  } else if (region === 'rowOrColumn') {
    // The scoring card sits where the row and column cross, so it is counted
    // once rather than twice (2*width - 1 distinct cells).
    for (let c = 0; c < width; c++) all.push({ r: pos.r, c })
    for (let r = 0; r < width; r++) if (r !== pos.r) all.push({ r, c: pos.c })
  } else {
    for (let r = 0; r < width; r++)
      for (let c = 0; c < width; c++) all.push({ r, c })
  }
  return all
}

function collect(player: Player, cells: Pos[], totalSeats: number): Scope {
  const filled: FilledSeat[] = []
  let openSeats = 0
  for (const { r, c } of cells) {
    const cell = player.grid[r]?.[c] ?? null
    if (cell === null) continue
    if (isOpenSeat(cell)) openSeats++
    else filled.push(cell)
  }
  return {
    filled,
    openSeats,
    emptySeats: totalSeats - filled.length - openSeats,
    approvals: player.approvals,
  }
}

/**
 * Scope covering the player's whole org, whatever shape the working grid is
 * currently in. Seat counts are taken against the nine seats an org always has,
 * not against the size of the backing array, so an ability that pays per empty
 * seat pays the same on turn one however the grid is stored.
 */
export function orgScope(player: Player): Scope {
  const width = widthOf(player)
  const cells: Pos[] = []
  for (let r = 0; r < player.grid.length; r++) {
    for (let c = 0; c < (player.grid[r]?.length ?? 0); c++) cells.push({ r, c })
  }
  return collect(player, cells, width * width)
}

/** The single interpreter for `Metric`. */
export function countMetric(m: Metric, s: Scope): number {
  const groupsIn = (pred: (g: Group) => boolean) =>
    s.filled.reduce((n, p) => n + p.card.groups.filter(pred).length, 0)
  const distinct = new Set(s.filled.flatMap((p) => p.card.groups))

  switch (m.count) {
    case 'group':
      return groupsIn((g) => g === m.group)
    case 'groupAny':
      return groupsIn((g) => m.groups.includes(g))
    case 'distinctGroups':
      return distinct.size
    case 'missingGroups':
      return ALL_GROUPS.filter((g) => !distinct.has(g)).length
    // A card's ribbon is the floor stripe down its edge, so it counts exactly
    // what `cardsAt` counts.
    case 'cardsAt':
    case 'ribbon':
      return s.filled.filter((p) => p.card.floor === m.floor).length
    case 'cardsWithCost':
      return s.filled.filter((p) => p.card.cost === m.cost).length
    case 'cardsWithCostAtLeast':
      return s.filled.filter((p) => p.card.cost >= m.cost).length
    case 'cardsWithGroups':
      return s.filled.filter((p) => p.card.groups.length === m.groups).length
    case 'discountCards':
      return s.filled.filter((p) => p.card.discount).length
    case 'openSeats':
      return s.openSeats
    case 'emptySeats':
      return s.emptySeats
    case 'filledSeats':
      return s.filled.length + s.openSeats
    case 'budgetLines':
      return s.filled.filter((p) => isBudgetLine(p.card)).length
    case 'budgetLineTotal':
      return s.filled.reduce(
        (n, p) => n + (isBudgetLine(p.card) ? p.budget : 0),
        0,
      )
    case 'approvals':
      return s.approvals
    default: {
      const _exhaustive: never = m
      return _exhaustive ? 0 : 0
    }
  }
}

function inArea(p: Pos, a: Area, width: number): boolean {
  const last = width - 1
  switch (a) {
    case 'topRow':
      return p.r === 0
    case 'middleRow':
      return p.r === 1
    case 'bottomRow':
      return p.r === last
    case 'leftColumn':
      return p.c === 0
    case 'middleColumn':
      return p.c === 1
    case 'rightColumn':
      return p.c === last
    case 'corner':
      return (p.r === 0 || p.r === last) && (p.c === 0 || p.c === last)
    case 'edgeCenter':
      // The four edge midpoints, which are the odd-parity cells.
      return (p.r + p.c) % 2 === 1
    case 'topLeft':
      return p.r === 0 && p.c === 0
    case 'topRight':
      return p.r === 0 && p.c === last
    case 'bottomLeft':
      return p.r === last && p.c === 0
    case 'bottomRight':
      return p.r === last && p.c === last
    default: {
      const _exhaustive: never = a
      return _exhaustive
    }
  }
}

function conditionHolds(
  when: Condition,
  pos: Pos,
  org: Scope,
  width: number,
): boolean {
  switch (when.when) {
    case 'inArea':
      return inArea(pos, when.area, width)
    case 'noGroup':
      return countMetric({ count: 'group', group: when.group }, org) === 0
    case 'hasOpenSeat':
      return org.openSeats >= 1
    default: {
      const _exhaustive: never = when
      return _exhaustive
    }
  }
}

/** How one card's points were arrived at, for the game-over breakdown. */
export type ScoreDetail =
  | {
      rule: 'perMetric'
      points: number
      per: Metric
      region: Region
      count: number
      result: number
    }
  | {
      rule: 'perSet'
      points: number
      of: Metric[]
      counts: number[]
      sets: number
      result: number
    }
  | {
      rule: 'perMatchingGroupSet'
      points: number
      size: number
      sets: number
      result: number
    }
  | {
      rule: 'perRun'
      points: number
      per: Metric
      size: number
      count: number
      runs: number
      result: number
    }
  | {
      rule: 'bonus'
      points: number
      when: Condition
      met: boolean
      result: number
    }
  | {
      rule: 'budgetLine'
      points: number
      budget: number
      cap: number
      stored: number
      result: number
    }

/** Points scored by one filled seat at `pos`, with its breakdown. */
function scoreSeat(
  seat: FilledSeat,
  pos: Pos,
  player: Player,
): { points: number; detail: ScoreDetail } {
  const width = widthOf(player)
  const s = resolveScoring(seat.card, width)
  const org = collect(player, cellsFor('org', pos, width), width * width)
  switch (s.score) {
    case 'perMetric': {
      const region = s.region ?? 'org'
      const scope =
        region === 'org'
          ? org
          : collect(player, cellsFor(region, pos, width), width)
      const count = countMetric(s.per, scope)
      const result = s.points * count
      return {
        points: result,
        detail: {
          rule: 'perMetric',
          points: s.points,
          per: s.per,
          region,
          count,
          result,
        },
      }
    }
    case 'perSet': {
      const counts = s.of.map((m) => countMetric(m, org))
      const sets = Math.min(...counts)
      const result = s.points * sets
      return {
        points: result,
        detail: {
          rule: 'perSet',
          points: s.points,
          of: s.of,
          counts,
          sets,
          result,
        },
      }
    }
    case 'perMatchingGroupSet': {
      let sets = 0
      for (const group of ALL_GROUPS) {
        sets += Math.floor(countMetric({ count: 'group', group }, org) / s.size)
      }
      const result = s.points * sets
      return {
        points: result,
        detail: {
          rule: 'perMatchingGroupSet',
          points: s.points,
          size: s.size,
          sets,
          result,
        },
      }
    }
    case 'perRun': {
      const count = countMetric(s.per, org)
      const runs = Math.floor(count / s.size)
      const result = s.points * runs
      return {
        points: result,
        detail: {
          rule: 'perRun',
          points: s.points,
          per: s.per,
          size: s.size,
          count,
          runs,
          result,
        },
      }
    }
    case 'bonus': {
      const met = conditionHolds(s.when, pos, org, width)
      const result = met ? s.points : 0
      return {
        points: result,
        detail: { rule: 'bonus', points: s.points, when: s.when, met, result },
      }
    }
    case 'budgetLine': {
      const stored = Math.min(seat.budget, s.cap)
      const result = s.points * stored
      return {
        points: result,
        detail: {
          rule: 'budgetLine',
          points: s.points,
          budget: seat.budget,
          cap: s.cap,
          stored,
          result,
        },
      }
    }
    default: {
      const _exhaustive: never = s
      return _exhaustive
    }
  }
}

// One entry per seat in reading order. Open and empty seats score nothing but
// are still listed, so the breakdown accounts for all nine.
export type SeatScore =
  | {
      kind: 'card'
      index: number
      id: string
      name: string
      points: number
      detail: ScoreDetail
    }
  | { kind: 'openSeat'; index: number; points: 0 }
  | { kind: 'empty'; index: number; points: 0 }

export interface ScoreBreakdown {
  total: number
  approvals: number
  seats: SeatScore[]
}

/**
 * Final score for a normalized 3x3 org: every performance review, plus one
 * point per approval still held.
 */
export function scoreOrg(player: Player): ScoreBreakdown {
  const width = widthOf(player)
  const seats: SeatScore[] = []
  for (let r = 0; r < width; r++) {
    for (let c = 0; c < width; c++) {
      const index = r * width + c
      const cell = player.grid[r]?.[c] ?? null
      if (cell === null) {
        seats.push({ kind: 'empty', index, points: 0 })
      } else if (isOpenSeat(cell)) {
        seats.push({ kind: 'openSeat', index, points: 0 })
      } else {
        const { points, detail } = scoreSeat(cell, { r, c }, player)
        seats.push({
          kind: 'card',
          index,
          id: cell.card.id,
          name: cell.card.name,
          points,
          detail,
        })
      }
    }
  }
  const cardPoints = seats.reduce((n, e) => n + e.points, 0)
  return {
    total: cardPoints + player.approvals,
    approvals: player.approvals,
    seats,
  }
}

// Rules text.
//
// Turns the shared `Metric` vocabulary into English, once, for everything that
// has to show a rule: the card faces, the inspector and the end-of-game score
// breakdown. Driven off the same unions the engine evaluates, so a card can
// never describe itself as doing something other than what it does.

import {
  type Area,
  type Card,
  type Condition,
  type Effect,
  type Floor,
  type Group,
  type Metric,
  type Region,
  type Resource,
  type ScoringRule,
} from './deck'
import type { ScoreDetail } from './scoring'

const GROUP_NAMES: Record<Group, string> = {
  leadership: 'Leadership',
  people: 'People',
  research: 'Research',
  product: 'Product',
  engineering: 'Engineering',
  design: 'Design',
}

const FLOOR_NAMES: Record<Floor, string> = {
  management: 'Management',
  ic: 'IC',
}

const AREA_NAMES: Record<Area, string> = {
  topRow: 'the top row',
  middleRow: 'the middle row',
  bottomRow: 'the bottom row',
  leftColumn: 'the left column',
  middleColumn: 'the middle column',
  rightColumn: 'the right column',
  corner: 'a corner',
  edgeCenter: 'the middle of an edge',
}

const REGION_NAMES: Record<Region, string> = {
  row: ' in this row',
  column: ' in this column',
  rowOrColumn: ' in this row or column',
  org: '',
}

const plural = (n: number, one: string, many = one + 's'): string =>
  `${n} ${n === 1 ? one : many}`

const resource = (r: Resource, n: number): string =>
  r === 'budget' ? `$${n}` : plural(n, 'approval')

/** What a metric counts, phrased to follow "per". */
export function describeMetric(m: Metric): string {
  switch (m.count) {
    case 'group':
      return `${GROUP_NAMES[m.group]} shield`
    case 'groupAny':
      return m.groups.map((g) => GROUP_NAMES[g]).join(' or ') + ' shield'
    case 'distinctGroups':
      return 'different department'
    case 'missingGroups':
      return 'department you have none of'
    case 'cardsAt':
      return `${FLOOR_NAMES[m.floor]} hire`
    case 'ribbon':
      return `${FLOOR_NAMES[m.floor]} ribbon`
    case 'cardsWithCost':
      return `hire costing $${m.cost}`
    case 'cardsWithCostAtLeast':
      return `hire costing $${m.cost} or more`
    case 'cardsWithGroups':
      return m.groups === 2 ? 'two-department hire' : 'single-department hire'
    case 'discountCards':
      return 'standing budget approval'
    case 'openSeats':
      return 'open seat'
    case 'emptySeats':
      return 'empty seat'
    case 'filledSeats':
      return 'filled seat'
    case 'budgetLines':
      return 'budget line'
    case 'budgetLineTotal':
      return 'dollar on a budget line'
    case 'approvals':
      return 'approval held'
    default: {
      const _exhaustive: never = m
      return _exhaustive
    }
  }
}

function describeCondition(c: Condition): string {
  switch (c.when) {
    case 'inArea':
      return `if this card ends up in ${AREA_NAMES[c.area]}`
    case 'noGroup':
      return `if you hire no ${GROUP_NAMES[c.group]}`
    case 'hasOpenSeat':
      return 'if you leave at least one seat open'
    default: {
      const _exhaustive: never = c
      return _exhaustive
    }
  }
}

/** The card's performance review, as a sentence. */
export function describeScoring(card: Card): string {
  const s: ScoringRule = card.scoring
  switch (s.score) {
    case 'perMetric':
      return `per ${describeMetric(s.per)}${REGION_NAMES[s.region ?? 'org']}`
    case 'perSet':
      return `per set of ${s.of.map(describeMetric).join(' + ')}`
    case 'perMatchingGroupSet':
      return `per ${s.size} shields of one department`
    case 'perRun':
      return `per ${s.size} ${describeMetric(s.per)}s`
    case 'bonus':
      return describeCondition(s.when)
    case 'budgetLine':
      return `per dollar stored here, up to $${s.cap}`
    default: {
      const _exhaustive: never = s
      return _exhaustive
    }
  }
}

function describeEffect(e: Effect): string {
  switch (e.effect) {
    case 'gain':
      return `Gain ${resource(e.resource, e.amount)}`
    case 'gainPer': {
      const whose = e.from === 'opponent' ? " of your opponent's" : ''
      return `Gain ${resource(e.resource, e.amount)} per ${describeMetric(e.per)}${whose}`
    }
    case 'opponentGains':
      return `Your opponent gains ${resource(e.resource, e.amount)}`
    case 'everyoneGains':
      return `Everyone gains ${resource(e.resource, e.amount)}`
    case 'fundBudgetLines': {
      const how = e.amount === 'toFull' ? 'Fill' : `Add $${e.amount} to`
      const which =
        e.target === 'each' ? 'every budget line' : `${e.target} budget lines`
      return `${how} ${which}`
    }
    case 'dropCandidate':
      return `Drop a ${FLOOR_NAMES[e.floor]} candidate and take its budget`
    case 'choose':
      return e.options
        .map((option) => option.map(describeEffect).join(', '))
        .join(' OR ')
    default: {
      const _exhaustive: never = e
      return _exhaustive
    }
  }
}

/** What the card does the moment it is hired. */
export function describeAbility(card: Card): string {
  if (card.discount) {
    const on =
      card.discount.on === 'all'
        ? 'every hire'
        : `${FLOOR_NAMES[card.discount.on]} hires`
    return `Later ${on} cost $${card.discount.amount} less`
  }
  if (card.ability.length === 0) return ''
  return card.ability.map(describeEffect).join('. ')
}

/** One line of the end-of-game breakdown, e.g. "Leadership shield: 3 x 4 = 12". */
export function describeDetail(detail: ScoreDetail): string {
  switch (detail.rule) {
    case 'perMetric':
      return `${describeMetric(detail.per)}${REGION_NAMES[detail.region]}: ${detail.count} x ${detail.points} = ${detail.result}`
    case 'perSet':
      return `sets of ${detail.of.map(describeMetric).join(' + ')}: ${detail.sets} x ${detail.points} = ${detail.result}`
    case 'perMatchingGroupSet':
      return `runs of ${detail.size}: ${detail.sets} x ${detail.points} = ${detail.result}`
    case 'perRun':
      return `${describeMetric(detail.per)} runs of ${detail.size}: ${detail.runs} x ${detail.points} = ${detail.result}`
    case 'bonus':
      return `${describeCondition(detail.when)}: ${detail.met ? `+${detail.points}` : '0'}`
    case 'budgetLine':
      return `stored $${detail.stored} of $${detail.cap}: ${detail.stored} x ${detail.points} = ${detail.result}`
    default: {
      const _exhaustive: never = detail
      return _exhaustive
    }
  }
}

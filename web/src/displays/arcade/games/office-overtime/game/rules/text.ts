// Rules text.
//
// Turns the shared `Metric` vocabulary into English, once, for everything that
// has to show a rule: the card faces, the end-of-game breakdown, the choice
// prompt. Driven off the same unions the engine evaluates, so a card can never
// describe itself as doing something other than what it does.
//
// The primary form is spans: `{ text, bold? }` with the numeric values marked
// bold, which the card face renders as mixed-weight rich text. The plain-string
// functions are derived by joining the spans, so older callers and tests keep
// working. All money reads in thousands ("15" is "15k") everywhere.

import type { TextSpan } from '@src/stargazer'
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

/** Money always reads in thousands: 15 becomes "15k". */
export const money = (n: number): string => `${n}k`

const t = (text: string): TextSpan => ({ text })
const b = (text: string): TextSpan => ({ text, bold: true })
const spanText = (spans: readonly TextSpan[]): string =>
  spans.map((s) => s.text).join('')

function joinSpans(groups: TextSpan[][], sep: string): TextSpan[] {
  const out: TextSpan[] = []
  groups.forEach((g, i) => {
    if (i > 0) out.push(t(sep))
    out.push(...g)
  })
  return out
}

/** A resource amount, value bold: "15k" for budget, "3 approvals" for approval. */
function resourceSpans(r: Resource, n: number): TextSpan[] {
  return r === 'budget'
    ? [b(money(n))]
    : [b(String(n)), t(n === 1 ? ' approval' : ' approvals')]
}

/** What a metric counts, phrased to follow "per". */
export function describeMetricSpans(m: Metric): TextSpan[] {
  switch (m.count) {
    case 'group':
      return [t(`${GROUP_NAMES[m.group]} shield`)]
    case 'groupAny':
      return [t(m.groups.map((g) => GROUP_NAMES[g]).join(' or ') + ' shield')]
    case 'distinctGroups':
      return [t('different department')]
    case 'missingGroups':
      return [t('department you have none of')]
    case 'cardsAt':
      return [t(`${FLOOR_NAMES[m.floor]} hire`)]
    case 'ribbon':
      return [t(`${FLOOR_NAMES[m.floor]} ribbon`)]
    case 'cardsWithCost':
      return [t('hire costing '), b(money(m.cost))]
    case 'cardsWithCostAtLeast':
      return [t('hire costing '), b(money(m.cost)), t(' or more')]
    case 'cardsWithGroups':
      return [
        t(m.groups === 2 ? 'two-department hire' : 'single-department hire'),
      ]
    case 'discountCards':
      return [t('standing budget approval')]
    case 'openSeats':
      return [t('open seat')]
    case 'emptySeats':
      return [t('empty seat')]
    case 'filledSeats':
      return [t('filled seat')]
    case 'budgetLines':
      return [t('budget line')]
    case 'budgetLineTotal':
      return [t('dollar on a budget line')]
    case 'approvals':
      return [t('approval held')]
    default: {
      const _exhaustive: never = m
      return _exhaustive
    }
  }
}

export const describeMetric = (m: Metric): string =>
  spanText(describeMetricSpans(m))

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

/** The card's performance review, as spans. */
export function describeScoringSpans(card: Card): TextSpan[] {
  const s: ScoringRule = card.scoring
  switch (s.score) {
    case 'perMetric':
      return [
        t('per '),
        ...describeMetricSpans(s.per),
        t(REGION_NAMES[s.region ?? 'org']),
      ]
    case 'perSet':
      return [
        t('per set of '),
        ...joinSpans(s.of.map(describeMetricSpans), ' + '),
      ]
    case 'perMatchingGroupSet':
      return [t('per '), b(String(s.size)), t(' shields of one department')]
    case 'perRun':
      return [
        t('per '),
        b(String(s.size)),
        t(' '),
        ...describeMetricSpans(s.per),
        t('s'),
      ]
    case 'bonus':
      return [t(describeCondition(s.when))]
    case 'budgetLine':
      return [t('per dollar stored here, up to '), b(money(s.cap))]
    default: {
      const _exhaustive: never = s
      return _exhaustive
    }
  }
}

export const describeScoring = (card: Card): string =>
  spanText(describeScoringSpans(card))

function describeEffectSpans(e: Effect): TextSpan[] {
  switch (e.effect) {
    case 'gain':
      return [t('Gain '), ...resourceSpans(e.resource, e.amount)]
    case 'gainPer': {
      const whose = e.from === 'opponent' ? " of your opponent's" : ''
      return [
        t('Gain '),
        ...resourceSpans(e.resource, e.amount),
        t(' per '),
        ...describeMetricSpans(e.per),
        t(whose),
      ]
    }
    case 'opponentGains':
      return [t('Your opponent gains '), ...resourceSpans(e.resource, e.amount)]
    case 'everyoneGains':
      return [t('Everyone gains '), ...resourceSpans(e.resource, e.amount)]
    case 'fundBudgetLines': {
      const how: TextSpan[] =
        e.amount === 'toFull'
          ? [t('Fill ')]
          : [t('Add '), b(money(e.amount)), t(' to ')]
      const which: TextSpan[] =
        e.target === 'each'
          ? [t('every budget line')]
          : [b(String(e.target)), t(' budget lines')]
      return [...how, ...which]
    }
    case 'dropCandidate':
      return [t(`Drop a ${FLOOR_NAMES[e.floor]} candidate and take its budget`)]
    case 'choose':
      return joinSpans(
        e.options.map((option) =>
          joinSpans(option.map(describeEffectSpans), ', '),
        ),
        ' OR ',
      )
    default: {
      const _exhaustive: never = e
      return _exhaustive
    }
  }
}

/** What the card does the moment it is hired, as spans. */
export function describeAbilitySpans(card: Card): TextSpan[] {
  if (card.discount) {
    const on =
      card.discount.on === 'all'
        ? 'every hire'
        : `${FLOOR_NAMES[card.discount.on]} hires`
    return [t(`Later ${on} cost `), b(money(card.discount.amount)), t(' less')]
  }
  if (card.ability.length === 0) return []
  return joinSpans(card.ability.map(describeEffectSpans), '. ')
}

export const describeAbility = (card: Card): string =>
  spanText(describeAbilitySpans(card))

/** One `choose` option as spans, for the prompt (a single effect list). */
export function describeOptionSpans(option: Effect[]): TextSpan[] {
  return joinSpans(option.map(describeEffectSpans), ', ')
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
      return `stored ${money(detail.stored)} of ${money(detail.cap)}: ${detail.stored} x ${detail.points} = ${detail.result}`
    default: {
      const _exhaustive: never = detail
      return _exhaustive
    }
  }
}

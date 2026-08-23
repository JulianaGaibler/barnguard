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

import type { TextRun } from '@src/stargazer'
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

export const GROUP_NAMES: Record<Group, string> = {
  leadership: 'Leadership',
  people: 'People',
  research: 'Research',
  product: 'Product',
  engineering: 'Engineering',
  design: 'Design',
}

export const FLOOR_NAMES: Record<Floor, string> = {
  management: 'Management',
  ic: 'IC',
}

export const AREA_NAMES: Record<Area, string> = {
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

const t = (text: string): TextRun => ({ text })
const b = (text: string): TextRun => ({ text, bold: true })
const spanText = (spans: readonly TextRun[]): string =>
  spans.map((s) => s.text).join('')

function joinSpans(groups: TextRun[][], sep: string): TextRun[] {
  const out: TextRun[] = []
  groups.forEach((g, i) => {
    if (i > 0) out.push(t(sep))
    out.push(...g)
  })
  return out
}

/** A resource amount, value bold: "15k" for budget, "3 approvals" for approval. */
function resourceSpans(r: Resource, n: number): TextRun[] {
  return r === 'budget'
    ? [b(money(n))]
    : [b(String(n)), t(n === 1 ? ' approval' : ' approvals')]
}

/** What a metric counts, phrased to follow "per". */
export function describeMetricSpans(m: Metric): TextRun[] {
  switch (m.count) {
    case 'group':
      return [t(`${GROUP_NAMES[m.group]} badge`)]
    case 'groupAny':
      return [t(m.groups.map((g) => GROUP_NAMES[g]).join(' or ') + ' badge')]
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
      return [t('open position')]
    case 'emptySeats':
      return [t('empty position')]
    case 'filledSeats':
      return [t('filled position')]
    case 'budgetLines':
      return [t('budget')]
    case 'budgetLineTotal':
      return [t('dollar of budget')]
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
      return 'if you leave at least one position open'
    default: {
      const _exhaustive: never = c
      return _exhaustive
    }
  }
}

/** The card's performance review, as spans. */
export function describeScoringSpans(card: Card): TextRun[] {
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
      return [t('per '), b(String(s.size)), t(' badges of one department')]
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

function describeEffectSpans(e: Effect): TextRun[] {
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
    // A budget holds nothing until the game is scored, so this pays out what
    // those budgets would have taken rather than filling them now.
    case 'fundBudgetLines': {
      if (e.amount === 'toFull') {
        return [
          t('Gain the budget to fill '),
          b(String(e.target)),
          t(e.target === 1 ? ' budget' : ' budgets'),
        ]
      }
      const per: TextRun[] =
        e.target === 'each'
          ? [t(' per budget')]
          : [t(' per budget, for '), b(String(e.target))]
      return [t('Gain '), b(money(e.amount)), ...per]
    }
    case 'dropCandidate':
      return [
        t(
          `Drop the last ${FLOOR_NAMES[e.floor]} candidate and take its value as budget`,
        ),
      ]
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
export function describeAbilitySpans(card: Card): TextRun[] {
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
export function describeOptionSpans(option: Effect[]): TextRun[] {
  return joinSpans(option.map(describeEffectSpans), ', ')
}

/** One line of the end-of-game breakdown, e.g. "Leadership badge: 3 x 4 = 12". */
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

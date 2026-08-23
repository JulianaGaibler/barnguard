// A card said at length, for a player who has not learned the symbols yet.
//
// `text.ts` writes the rulebook phrasing that fits in a band thirty pixels tall.
// This writes the paragraph that band has no room for: second person, plain
// words, and above all the timing, since when a rule pays out is the one thing
// artwork on a card cannot show. Leftover budget is the case this exists for.
// It settles after the last hire, so nothing on the board ever demonstrates it.
//
// The prose carries the same marks the card face does, so a reader who works a
// rule out here can find it again on the card. Figures are bold and each one is
// followed by its mark. Nothing else is, because a paragraph with a picture
// beside every noun is no easier to read than the card already was.

import type { TextRun, TextSpan } from '@src/stargazer'
import { GROUP_NAMES, AREA_NAMES, money } from './text'
import { glyphSpan } from '../../art/glyphs'
import type { Glyph } from '../../art/glyphs'
import type {
  Card,
  Condition,
  Effect,
  Group,
  Metric,
  Resource,
  ScoringRule,
} from './deck'

/**
 * A rule a card leans on that its own face cannot teach.
 *
 * Only rules a particular card raises. Departments, floors and where a card
 * ends up are the basics every card shares, so they belong to the tutorial and
 * would be the same four paragraphs on all seventy-eight cards here.
 */
export type ConceptId =
  | 'budgetLine'
  | 'approvals'
  | 'printedCost'
  | 'set'
  | 'run'
  | 'aiSeat'
  | 'discount'

/**
 * One paragraph of the on-hire section.
 *
 * A choice is its own kind rather than a sentence with "or" in it, because the
 * two branches are alternatives and a reader has to be able to weigh them side
 * by side.
 */
export type HelpBlock =
  | { kind: 'line'; spans: TextSpan[] }
  | { kind: 'choice'; options: TextSpan[][] }

export interface CardHelp {
  /** Departments, floor and price, as one line under the name. */
  subtitle: TextSpan[]
  /** One paragraph per on-hire effect. Empty when the card does nothing. */
  onHire: HelpBlock[]
  /** What the performance review pays, and when. */
  review: TextSpan[]
  /** Only the rules this card raises, in reading order. */
  concepts: ConceptId[]
}

const t = (text: string): TextRun => ({ text })
const b = (text: string): TextRun => ({ text, bold: true })

/**
 * A mark set off from the words it belongs to.
 *
 * `alt` is what the span reads as, and most of these read as nothing: the words
 * beside them already say it, and a mark that repeats them turns "3 approvals"
 * into "3 approvals approvals" for anyone reading the line back as text.
 */
const g = (glyph: Glyph, alt: string): TextSpan =>
  glyphSpan(glyph, { leadEm: 0.18, alt })

/**
 * A mark opening a paragraph.
 *
 * The gap goes on the glyph rather than into the sentence, so the line still
 * reads back without a space in front of its first word.
 */
const lead = (glyph: Glyph): TextSpan =>
  glyphSpan(glyph, { trailEm: 0.35, alt: '' })

const FLOOR_LONG: Record<string, string> = {
  management: 'Management',
  ic: 'Individual Contributor',
}

/** A money figure and its note. */
const cash = (n: number): TextSpan[] => [
  b(money(n)),
  g({ g: 'budget' }, ' budget'),
]

/** A count of approvals and its slip. */
const slips = (n: number): TextSpan[] => [
  b(String(n)),
  t(n === 1 ? ' approval' : ' approvals'),
  g({ g: 'approval' }, ''),
]

/** A floor and its mark. */
const floorHire = (floor: 'management' | 'ic'): TextSpan[] => [
  t(floor === 'ic' ? 'Individual Contributor' : 'Management hire'),
  g({ g: 'floor', floor }, ''),
]

/** A department and its badge. */
const badge = (group: Group): TextSpan[] => [
  b(GROUP_NAMES[group]),
  g({ g: 'group', group }, ''),
]

/** The cards that hold leftover budget, and the bag that marks them. */
const bag = (many: boolean): TextSpan[] => [
  t(many ? 'cards that store budget' : 'card that stores budget'),
  g({ g: 'bag' }, ''),
]

const amount = (resource: Resource, n: number): TextSpan[] =>
  resource === 'budget' ? cash(n) : slips(n)

/** A noun phrase in both numbers, since these read after "one" and after "3". */
interface Countable {
  one: TextSpan[]
  many: TextSpan[]
}

/**
 * What a metric counts, as it reads after "every" or after a number.
 *
 * Deliberately not `describeMetric`, which is cut to follow the word "per" on a
 * card face and comes out clipped. Neither form names the org it counts over,
 * because the sentence around it already does.
 */
function countable(m: Metric): Countable {
  const flat = (one: string, many = `${one}s`): Countable => ({
    one: [t(one)],
    many: [t(many)],
  })
  switch (m.count) {
    case 'group':
      return {
        one: [...badge(m.group), t(' badge')],
        many: [...badge(m.group), t(' badges')],
      }
    case 'groupAny': {
      const names = m.groups.flatMap((group, i) =>
        i === 0 ? badge(group) : [t(' or '), ...badge(group)],
      )
      return { one: [...names, t(' badge')], many: [...names, t(' badges')] }
    }
    case 'distinctGroups':
      return {
        one: [t('different department'), g({ g: 'notEqual' }, '')],
        many: [t('different departments'), g({ g: 'notEqual' }, '')],
      }
    case 'missingGroups':
      return {
        one: [t('missing department'), g({ g: 'missingGroup' }, '')],
        many: [t('missing departments'), g({ g: 'missingGroup' }, '')],
      }
    case 'cardsAt':
    case 'ribbon':
      return {
        one: floorHire(m.floor),
        many: [...floorHire(m.floor), t('s')],
      }
    case 'cardsWithCost':
      return {
        one: [t('hire that cost '), ...cash(m.cost)],
        many: [t('hires that cost '), ...cash(m.cost)],
      }
    case 'cardsWithCostAtLeast':
      return {
        one: [t('hire that cost '), ...cash(m.cost), t(' or more')],
        many: [t('hires that cost '), ...cash(m.cost), t(' or more')],
      }
    case 'cardsWithGroups': {
      const how = m.groups === 2 ? 'two departments' : 'a single department'
      return flat(`hire carrying ${how}`, `hires carrying ${how}`)
    }
    case 'discountCards':
      return flat(
        'hire that makes later hires cheaper',
        'hires that make later hires cheaper',
      )
    case 'openSeats':
      return {
        one: [t('seat filled with AI'), g({ g: 'aiSeat' }, '')],
        many: [t('seats filled with AI'), g({ g: 'aiSeat' }, '')],
      }
    case 'emptySeats':
      return {
        one: [t('empty seat'), g({ g: 'emptySeat' }, '')],
        many: [t('empty seats'), g({ g: 'emptySeat' }, '')],
      }
    case 'filledSeats':
      return {
        one: [t('seat already taken'), g({ g: 'filledSeat' }, '')],
        many: [t('seats already taken'), g({ g: 'filledSeat' }, '')],
      }
    case 'budgetLines':
      return { one: bag(false), many: bag(true) }
    case 'budgetLineTotal':
      return {
        one: [...cash(1), t(' stored on a budget card')],
        many: [...cash(1), t(' stored')],
      }
    case 'approvals':
      return flat('approval you are holding', 'approvals you are holding')
    default: {
      const _exhaustive: never = m
      return _exhaustive
    }
  }
}

/** "a, b and c", for a list the reader has to take as a whole. */
function series(parts: TextSpan[][]): TextSpan[] {
  if (parts.length < 2) return parts[0] ?? []
  const out: TextSpan[] = []
  parts.forEach((part, i) => {
    if (i > 0) out.push(t(i === parts.length - 1 ? ' and ' : ', '))
    out.push(...part)
  })
  return out
}

function effectSentence(e: Effect): TextSpan[] {
  switch (e.effect) {
    case 'gain':
      return [t('You get '), ...amount(e.resource, e.amount), t('.')]
    case 'gainPer':
      // Counting your own org includes the card doing the counting, since it is
      // seated before its ability resolves. The opponent's never holds it.
      return [
        t('You get '),
        ...amount(e.resource, e.amount),
        t(' for every '),
        ...countable(e.per).one,
        t(
          e.from === 'opponent'
            ? " in your opponent's org."
            : ', counting this one.',
        ),
      ]
    case 'opponentGains':
      return [t('Your opponent gets '), ...amount(e.resource, e.amount), t('.')]
    case 'everyoneGains':
      return [
        t('You and your opponent each get '),
        ...amount(e.resource, e.amount),
        t('.'),
      ]
    case 'fundBudgetLines': {
      if (e.amount === 'toFull') {
        const n = e.target === 'each' ? 1 : e.target
        return [
          t('You get enough budget to fill your '),
          b(String(n)),
          t(n === 1 ? ' roomiest budget card.' : ' roomiest budget cards.'),
        ]
      }
      return e.target === 'each'
        ? [
            t('You get '),
            ...cash(e.amount),
            t(' for every '),
            ...bag(false),
            t('.'),
          ]
        : [
            t('You get '),
            ...cash(e.amount),
            t(' for each of your '),
            b(String(e.target)),
            t(' roomiest budget cards.'),
          ]
    }
    case 'dropCandidate':
      return [
        t(
          `Throws out the last ${FLOOR_LONG[e.floor]} candidate. You take its price as budget.`,
        ),
      ]
    case 'choose':
      // Handled by `effectBlock`, which boxes the branches rather than running
      // them into one sentence.
      return e.options.flatMap((option) => option.flatMap(effectSentence))
    default: {
      const _exhaustive: never = e
      return _exhaustive
    }
  }
}

function effectBlock(e: Effect): HelpBlock {
  if (e.effect !== 'choose') return { kind: 'line', spans: effectSentence(e) }
  return {
    kind: 'choice',
    options: e.options.map((option) => option.flatMap(effectSentence)),
  }
}

function conditionClause(c: Condition): TextSpan[] {
  switch (c.when) {
    case 'inArea':
      return [t(`it ends up in ${AREA_NAMES[c.area]}`)]
    case 'noGroup':
      return [t('your org has no '), ...badge(c.group), t(' badges')]
    case 'hasOpenSeat':
      return [
        t('at least one of your seats is filled with AI'),
        g({ g: 'aiSeat' }, ''),
      ]
    default: {
      const _exhaustive: never = c
      return _exhaustive
    }
  }
}

// Your own org is the default scope, so only a narrower one is named.
const WHERE: Record<string, string> = {
  row: ' in its row',
  column: ' in its column',
  rowOrColumn: ' in its row or column',
  org: '',
}

function reviewSentence(s: ScoringRule, points: number): TextSpan[] {
  const pts = [b(String(points)), t(points === 1 ? ' point' : ' points')]
  switch (s.score) {
    case 'perMetric':
      return [
        t('Pays '),
        ...pts,
        t(' for every '),
        ...countable(s.per).one,
        t(`${WHERE[s.region ?? 'org']}.`),
      ]
    case 'perSet':
      return [
        t('Pays '),
        ...pts,
        t(' for every set of '),
        ...series(s.of.map((m) => countable(m).one)),
        t('.'),
      ]
    case 'perMatchingGroupSet':
      return [
        t('Pays '),
        ...pts,
        t(' for every '),
        b(String(s.size)),
        t(' badges of the same department.'),
      ]
    case 'perRun':
      return [
        t('Pays '),
        ...pts,
        t(' for every '),
        b(String(s.size)),
        t(' '),
        ...countable(s.per).many,
        t('.'),
      ]
    case 'bonus':
      return [t('Pays '), ...pts, t(' if '), ...conditionClause(s.when), t('.')]
    case 'budgetLine':
      return [
        t('Holds up to '),
        ...cash(s.cap),
        t(' of leftover budget. Pays '),
        ...pts,
        t(' per '),
        ...cash(1),
        t(' stored, so a full one is worth '),
        b(String(s.cap * points)),
        t('.'),
      ]
    default: {
      const _exhaustive: never = s
      return _exhaustive
    }
  }
}

export const CONCEPTS: Record<
  ConceptId,
  { title: string; body: TextSpan[][] }
> = {
  budgetLine: {
    title: 'Leftover budget',
    body: [
      [
        lead({ g: 'bag' }),
        t(
          'Budget you never spend is not wasted when you have leftover budget cards.',
        ),
      ],
      [
        t('At the end of the game, your remaining budget is spread over the '),
        ...bag(true),
        t('you have.'),
      ],
      [t('Budget that fits nowhere scores nothing. It only breaks a tie.')],
    ],
  },
  approvals: {
    title: 'Approvals',
    body: [
      [
        lead({ g: 'approval' }),
        t(
          'Approvals are what you spend on your own turn. One moves the floor marker, one deals a fresh row. You may do both.',
        ),
      ],
      [
        t('Every approval'),
        g({ g: 'approval' }, ''),
        t(' you still hold at the end is worth a point.'),
      ],
    ],
  },
  printedCost: {
    title: 'Printed price',
    body: [
      [
        lead({ g: 'budget' }),
        t('This counts what a card says it costs, not what you paid.'),
      ],
      [
        t('A '),
        ...cash(5),
        t(' hire you picked up for '),
        ...cash(3),
        t(' still counts as a '),
        ...cash(5),
        t(' hire.'),
      ],
    ],
  },
  set: {
    title: 'Sets',
    body: [
      [t('A set pays once for one of each thing listed.')],
      [t('A spare of one kind is worth nothing until the others catch up.')],
    ],
  },
  run: {
    title: 'Whole groups only',
    body: [
      [t('This pays per complete group, not per card.')],
      [
        t(
          'The remainder scores nothing. Two thirds of a group is worth no more than none.',
        ),
      ],
    ],
  },
  aiSeat: {
    title: 'Seats filled with AI',
    body: [
      [
        lead({ g: 'aiSeat' }),
        t(
          'Any candidate can be taken face down instead of hired, filling the seat with AI.',
        ),
      ],
      [
        t(
          'It costs nothing and pays budget and approvals. It carries no departments, no floor and no review, and still uses one of your nine seats.',
        ),
      ],
    ],
  },
  discount: {
    title: 'Cheaper hires',
    body: [
      [t('The discount lasts the rest of the game and stack.')],
      [
        t(
          'It never applies to the card that brings it, and cannot take a price below zero.',
        ),
      ],
    ],
  },
}

/** Add `id` once, keeping the order the concepts were first reached in. */
function note(into: ConceptId[], id: ConceptId): void {
  if (!into.includes(id)) into.push(id)
}

function metricConcepts(m: Metric, into: ConceptId[]): void {
  switch (m.count) {
    // Departments and floors are the basics, so counting them raises nothing a
    // card has to explain.
    case 'group':
    case 'groupAny':
    case 'distinctGroups':
    case 'missingGroups':
    case 'cardsAt':
    case 'ribbon':
    case 'cardsWithGroups':
      return
    case 'cardsWithCost':
    case 'cardsWithCostAtLeast':
      note(into, 'printedCost')
      return
    case 'discountCards':
      note(into, 'discount')
      return
    case 'openSeats':
      note(into, 'aiSeat')
      return
    case 'emptySeats':
    case 'filledSeats':
      return
    case 'budgetLines':
    case 'budgetLineTotal':
      note(into, 'budgetLine')
      return
    case 'approvals':
      note(into, 'approvals')
      return
    default: {
      const _exhaustive: never = m
      void _exhaustive
    }
  }
}

function effectConcepts(e: Effect, into: ConceptId[]): void {
  switch (e.effect) {
    case 'gain':
      if (e.resource === 'approval') note(into, 'approvals')
      return
    case 'gainPer':
      if (e.resource === 'approval') note(into, 'approvals')
      metricConcepts(e.per, into)
      return
    case 'opponentGains':
    case 'everyoneGains':
      if (e.resource === 'approval') note(into, 'approvals')
      return
    case 'fundBudgetLines':
      note(into, 'budgetLine')
      return
    case 'dropCandidate':
      return
    case 'choose':
      for (const option of e.options) {
        for (const inner of option) effectConcepts(inner, into)
      }
      return
    default: {
      const _exhaustive: never = e
      void _exhaustive
    }
  }
}

function scoringConcepts(s: ScoringRule, into: ConceptId[]): void {
  switch (s.score) {
    case 'perMetric':
      metricConcepts(s.per, into)
      return
    case 'perSet':
      note(into, 'set')
      for (const m of s.of) metricConcepts(m, into)
      return
    case 'perMatchingGroupSet':
      note(into, 'run')
      return
    case 'perRun':
      note(into, 'run')
      metricConcepts(s.per, into)
      return
    case 'bonus':
      if (s.when.when === 'hasOpenSeat') note(into, 'aiSeat')
      return
    case 'budgetLine':
      note(into, 'budgetLine')
      return
    default: {
      const _exhaustive: never = s
      void _exhaustive
    }
  }
}

/** Everything the sheet says about one card. */
export function explainCard(card: Card): CardHelp {
  const price: TextSpan[] = card.cost > 0 ? cash(card.cost) : [t('free')]
  // Two badges of one department is a common shape, and naming it twice reads
  // as a mistake.
  const [first, second] = card.groups
  const departments =
    second !== undefined && second === first
      ? [...badge(first), t(' \u00d72')]
      : series(card.groups.map(badge))
  const subtitle = [
    ...departments,
    t(` · ${FLOOR_LONG[card.floor]} · `),
    ...price,
  ]

  const onHire: HelpBlock[] = []
  if (card.discount) {
    const { on, amount: off } = card.discount
    const scope: TextSpan[] =
      on === 'all'
        ? [t('Every later hire')]
        : [t('Every later '), ...floorHire(on)]
    onHire.push({
      kind: 'line',
      spans: [...scope, t(' costs '), ...cash(off), t(' less.')],
    })
  }
  for (const e of card.ability) onHire.push(effectBlock(e))
  if (card.sendsMarkerTo) {
    onHire.push({
      kind: 'line',
      spans: [
        lead({ g: 'elevator' }),
        t('Moves the floor marker to '),
        ...floorHire(card.sendsMarkerTo),
        t('.'),
      ],
    })
  }

  const concepts: ConceptId[] = []
  if (card.discount) note(concepts, 'discount')
  for (const e of card.ability) effectConcepts(e, concepts)
  scoringConcepts(card.scoring, concepts)

  return {
    subtitle,
    onHire,
    review: reviewSentence(card.scoring, card.scoring.points),
    concepts,
  }
}

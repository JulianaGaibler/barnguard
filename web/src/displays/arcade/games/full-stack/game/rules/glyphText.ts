// Rules text for the card face, in symbols.
//
// The same unions `text.ts` puts into English, said in pictures instead:
// departments as badges, floors as their marks, resources as slips and notes,
// a scoring region as an arrow, a placement bonus as the org grid. Verbs go,
// because a card has no room for them and the layout says what they said. The
// words that relate one symbol to another stay, because "per" and "OR" carry
// meaning no icon here carries.
//
// Not every variant has symbols yet, and the line between what falls back and
// what does not is drawn per vocabulary rather than per clause. Every resource
// has a symbol, so a payout is always a symbol and a card that says "1k" in
// words is a card the reader has to check twice. Not every metric has one, so a
// metric with no symbol keeps its phrase and the clause reads "1k[note] per
// empty seat". A rule whose shape itself has no symbol, such as a region ring
// with nothing to put in the hole, still falls back whole: half a diagram says
// less than a sentence.
//
// `text.ts` stays the prose form for everything with room for it, which is the
// choice prompt and the end-of-game breakdown.

import type { InlineBox, TextRun, TextSpan } from '@src/stargazer'
import {
  type Card,
  type Condition,
  type Effect,
  type Metric,
  type Resource,
  type ScoringRule,
} from './deck'
import {
  describeAbilitySpans,
  describeMetricSpans,
  describeOptionSpans,
  describeScoringSpans,
  money,
} from './text'
import { glyphSpan } from '../../art/glyphs'
import type { Glyph, GlyphOptions, SimpleGlyph } from '../../art/glyphs'

const t = (text: string): TextRun => ({ text })
const b = (text: string): TextRun => ({ text, bold: true })
const g = (glyph: Glyph, options?: GlyphOptions): TextSpan =>
  glyphSpan(glyph, options)

/**
 * A glyph welds to its neighbour, since it is not whitespace. These are the
 * gaps that puts back: `AFTER_VALUE` sets a symbol off the number it belongs
 * to, and `BETWEEN` separates two symbols that have to stay countable.
 */
const AFTER_VALUE: GlyphOptions = { leadEm: 0.3 }
const BETWEEN: GlyphOptions = { leadEm: 0.28 }

/**
 * Air on the side of a symbol that faces a word.
 *
 * A space separates two words, and a symbol is not a word. It reads as its own
 * object, so the gap that is enough between "per" and "IC" is not enough
 * between "per" and the mark standing for IC. Added on top of whatever a span
 * already asked for, so a symbol welded to its own value keeps the weld.
 */
const BESIDE_WORD = 0.3

const isBox = (span: TextSpan): span is InlineBox => 'box' in span

/** Open up every symbol that sits against a word rather than against a value. */
function breathe(spans: TextSpan[]): TextSpan[] {
  return spans.map((span, i) => {
    if (!isBox(span)) return span
    const before = spans[i - 1]
    const after = spans[i + 1]
    const lead =
      before !== undefined && !isBox(before) && /\s$/.test(before.text)
    const trail = after !== undefined && !isBox(after) && /^\s/.test(after.text)
    if (!lead && !trail) return span
    return {
      ...span,
      ...(lead ? { leadEm: (span.leadEm ?? 0) + BESIDE_WORD } : {}),
      ...(trail ? { trailEm: (span.trailEm ?? 0) + BESIDE_WORD } : {}),
    }
  })
}

/**
 * Above this many, a resource reads as a count and one symbol rather than one
 * symbol per unit. Three slips are quicker to take in than the numeral. Four
 * are not, and they cost a line.
 */
const MAX_REPEATS = 3

/**
 * How much a symbol grows when the clause is nothing but symbols.
 *
 * A glyph is cut to sit among words, and a card whose whole ability is two
 * approval slips has none for it to sit among. The band is cut for two lines,
 * so one line of symbols has room to take.
 */
const SOLO_SCALE = 2

/** What a metric counts, in symbols where it has them and in words where not. */
function metricSpans(m: Metric): TextSpan[] {
  return metricGlyphs(m) ?? describeMetricSpans(m)
}

/**
 * A resource amount. Budget is a figure and a note, approvals are slips.
 *
 * The alt overrides are what keep the line readable back out as a sentence. A
 * note after a figure says " budget" so the pair is "1k budget", and a run of
 * slips says its count once rather than the word once per slip.
 */
function resourceGlyphs(r: Resource, n: number, scale = 1): TextSpan[] {
  if (r === 'budget') {
    return [
      b(money(n)),
      g({ g: 'budget' }, { ...AFTER_VALUE, scale, alt: ' budget' }),
    ]
  }
  if (n > MAX_REPEATS) {
    return [
      b(String(n)),
      g({ g: 'approval' }, { ...AFTER_VALUE, scale, alt: ' approvals' }),
    ]
  }
  const count = Math.max(1, n)
  return Array.from({ length: count }, (_, i) =>
    g(
      { g: 'approval' },
      {
        ...(i === 0 ? {} : BETWEEN),
        scale,
        alt: i === 0 ? `${count} approval${count === 1 ? '' : 's'}` : '',
      },
    ),
  )
}

/**
 * The single symbol a metric counts, when it has one.
 *
 * Separate from `metricGlyphs` because a region ring holds exactly one piece of
 * artwork in its hole. A metric that needs a phrase cannot go inside it.
 */
function metricGlyph(m: Metric): SimpleGlyph | null {
  switch (m.count) {
    case 'group':
      return { g: 'group', group: m.group }
    case 'distinctGroups':
      return { g: 'notEqual' }
    case 'cardsAt':
    case 'ribbon':
      return { g: 'floor', floor: m.floor }
    default:
      return null
  }
}

/**
 * What a metric counts, phrased to follow "per", or null when it has no
 * symbols.
 */
function metricGlyphs(m: Metric): TextSpan[] | null {
  const one = metricGlyph(m)
  if (one) return [g(one)]
  switch (m.count) {
    case 'groupAny':
      // Spelled out, because a slash between two badges reads as often as "a
      // pair of these" as it does "either of these".
      return m.groups.flatMap((group, i) =>
        i === 0
          ? [g({ g: 'group', group })]
          : [t(' or '), g({ g: 'group', group })],
      )
    case 'approvals':
      return [g({ g: 'approval' }, { alt: 'approval' }), t(' held')]
    case 'budgetLines':
      return [g({ g: 'bag' })]
    case 'missingGroups':
      return [t('missing '), g({ g: 'missingGroup' })]
    case 'openSeats':
      return [g({ g: 'aiSeat' })]
    // The grids show emptiness and fullness plainly enough at a glance, but the
    // two are the same nine cells in two inks, so the word is what makes sure
    // the reader is looking at the difference.
    case 'emptySeats':
      return [t('empty '), g({ g: 'emptySeat' })]
    case 'filledSeats':
      return [t('filled '), g({ g: 'filledSeat' })]
    case 'cardsWithCost':
      return [
        t('hire at '),
        b(money(m.cost)),
        g({ g: 'budget' }, { ...AFTER_VALUE, alt: ' budget' }),
      ]
    case 'cardsWithCostAtLeast':
      return [
        t('hire at '),
        b(money(m.cost)),
        g({ g: 'budget' }, { ...AFTER_VALUE, alt: ' budget' }),
        t(' or more'),
      ]
    case 'budgetLineTotal':
      return [
        b(money(1)),
        g({ g: 'budget' }, { ...AFTER_VALUE, alt: ' budget' }),
        t(' in a '),
        g({ g: 'bag' }),
      ]
    default:
      return null
  }
}

function scoringGlyphs(s: ScoringRule): TextSpan[] | null {
  switch (s.score) {
    case 'perMetric': {
      const region = s.region ?? 'org'
      if (region !== 'org') {
        // The ring goes around the thing counted, so the metric has to be one
        // symbol. A metric that only has a phrase leaves the clause in prose.
        const inner = metricGlyph(s.per)
        return inner ? [t('per '), g({ g: 'region', region, inner })] : null
      }
      return [t('per '), ...metricSpans(s.per)]
    }
    case 'perMatchingGroupSet':
      return [
        t('per '),
        b(String(s.size)),
        g({ g: 'equal' }, { ...AFTER_VALUE, alt: ' of one department' }),
      ]
    case 'perRun':
      return [t('per '), b(String(s.size)), t(' '), ...metricSpans(s.per)]
    case 'perSet':
      // A set pays once per full collection, so the members are joined with a
      // plus. Anything else reads as a list of alternatives.
      return [t('per set '), ...join(s.of.map(metricSpans), ' + ')]
    case 'bonus':
      return conditionGlyphs(s.when)
    case 'budgetLine':
      // The bag is where leftover budget lands when the game is scored, and
      // saying so is the whole job of this line: the seat holds nothing while
      // the match is being played, so nothing on the board would otherwise tell
      // the reader that budget is worth keeping.
      return [
        t('per '),
        b(money(1)),
        g({ g: 'budget' }, { ...AFTER_VALUE, alt: ' budget' }),
        t(' in '),
        g({ g: 'bag' }, { alt: 'this budget line' }),
        t(', max '),
        b(money(s.cap)),
        g({ g: 'budget' }, { ...AFTER_VALUE, alt: ' budget' }),
      ]
    default:
      return null
  }
}

function conditionGlyphs(c: Condition): TextSpan[] | null {
  switch (c.when) {
    case 'inArea':
      return [t('if placed in '), g({ g: 'area', area: c.area })]
    case 'noGroup':
      return [t('if no '), g({ g: 'group', group: c.group })]
    case 'hasOpenSeat':
      return [t('if you leave an '), g({ g: 'aiSeat' })]
    default:
      return null
  }
}

/**
 * A payout worked out against the org as it stands, for a clause that only
 * states a rate. What "1k per Management" comes to is the thing the player
 * actually wants off the card, and it is arithmetic they would otherwise do at
 * every glance.
 */
function paysNow(r: Resource, pays: number | null): TextSpan[] {
  if (pays === null) return []
  return [t(' ('), b(r === 'budget' ? money(pays) : String(pays)), t(')')]
}

function effectGlyphs(
  e: Effect,
  pays: number | null = null,
): TextSpan[] | null {
  switch (e.effect) {
    case 'gain':
      return resourceGlyphs(e.resource, e.amount)
    case 'gainPer': {
      // Whose org is counted goes in front of the thing counted. Trailing it
      // puts the one word that flips what the card is worth at the far end of
      // the line, where it is read last or not at all.
      return [
        ...resourceGlyphs(e.resource, e.amount),
        t(e.from === 'opponent' ? " per opponent's " : ' per '),
        ...metricSpans(e.per),
        ...paysNow(e.resource, pays),
      ]
    }
    case 'opponentGains':
      return [t('Opponent gets '), ...resourceGlyphs(e.resource, e.amount)]
    case 'everyoneGains':
      return [t('Both get '), ...resourceGlyphs(e.resource, e.amount)]
    // Since a seat holds nothing until the settlement, this pays the player
    // what the lines would have taken rather than putting it on them.
    case 'fundBudgetLines': {
      const many = { alt: 'budget lines' }
      if (e.amount === 'toFull') {
        return [
          t('Budget to fill '),
          b(String(e.target)),
          t(' '),
          g({ g: 'bag' }, e.target === 1 ? undefined : many),
        ]
      }
      const per: TextSpan[] =
        e.target === 'each'
          ? [g({ g: 'bag' })]
          : [b(String(e.target)), t(' '), g({ g: 'bag' }, many)]
      return [...resourceGlyphs('budget', e.amount), t(' per '), ...per]
    }
    case 'dropCandidate':
      return [
        t('Drop last '),
        g({ g: 'floor', floor: e.floor }),
        t(', take its '),
        g({ g: 'budget' }),
      ]
    case 'choose': {
      const options = e.options.map(optionGlyphs)
      if (options.some((o) => o === null)) return null
      return join(options as TextSpan[][], ' OR ')
    }
    default:
      return null
  }
}

function optionGlyphs(option: Effect[]): TextSpan[] | null {
  const parts = option.map(effectGlyphs)
  if (parts.some((p) => p === null)) return null
  return join(parts as TextSpan[][], ', ')
}

function join(groups: TextSpan[][], sep: string): TextSpan[] {
  const out: TextSpan[] = []
  groups.forEach((group, i) => {
    if (i > 0) out.push(t(sep))
    out.push(...group)
  })
  return out
}

/** The card's performance review, for the card face. */
export function scoringFaceSpans(card: Card): TextSpan[] {
  return breathe(scoringGlyphs(card.scoring) ?? describeScoringSpans(card))
}

/** One branch of a `choose` card, for the prompt that asks which. */
export function optionFaceSpans(option: Effect[]): TextSpan[] {
  return breathe(optionGlyphs(option) ?? describeOptionSpans(option))
}

/**
 * What the card does the moment it is hired, for the card face.
 *
 * `pays` is what each effect would come to against the org as it stands now,
 * from `previewAbility`, one entry per `card.ability`. A card already in an org
 * has resolved and passes nothing.
 */
export function abilityFaceSpans(
  card: Card,
  pays: readonly (number | null)[] = [],
): TextSpan[] {
  // A discount is a standing rule rather than an effect, so it is not in the
  // `Effect` union and gets its own line.
  if (card.discount) {
    const { on, amount } = card.discount
    const scope: TextSpan[] =
      on === 'all' ? [t('All')] : [g({ g: 'floor', floor: on })]
    return breathe([
      ...scope,
      t(' hires cost '),
      b(money(amount)),
      g({ g: 'budget' }, { ...AFTER_VALUE, alt: ' budget' }),
      t(' less'),
    ])
  }
  if (card.ability.length === 0) return describeAbilitySpans(card)
  // A lone payout is the one ability with nothing else on the line, so it is
  // the one that can afford a larger symbol.
  const only = card.ability.length === 1 ? card.ability[0] : null
  if (only?.effect === 'gain') {
    return breathe(resourceGlyphs(only.resource, only.amount, SOLO_SCALE))
  }
  const parts = card.ability.map((e, i) => effectGlyphs(e, pays[i] ?? null))
  if (parts.some((p) => p === null)) return describeAbilitySpans(card)
  // A plus, because the deck also has cards that make you pick one, and a full
  // stop between two clauses does not say which kind you are holding.
  return breathe(join(parts as TextSpan[][], ' + '))
}

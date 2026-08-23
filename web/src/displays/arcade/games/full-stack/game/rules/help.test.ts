import { describe, expect, it } from 'vitest'
import { richText } from '@src/stargazer'
import { CONCEPTS, explainCard, type ConceptId, type HelpBlock } from './help'
import { DECK } from './deck'

/** Every word of a block, whichever kind it is. */
const blockText = (block: HelpBlock): string =>
  block.kind === 'choice'
    ? block.options.map(richText).join(' or ')
    : richText(block.spans)

const CONCEPT_IDS = Object.keys(CONCEPTS) as ConceptId[]

describe('card explanations', () => {
  it.each(DECK.map((c) => [c.name, c.id] as const))(
    '%s is explained in full',
    (_name, id) => {
      const card = DECK.find((c) => c.id === id)!
      const help = explainCard(card)
      expect(richText(help.subtitle)).toBeTruthy()
      expect(richText(help.review)).toBeTruthy()
      // A card with rules text has something to say about being hired, and a
      // card with none says nothing rather than an empty paragraph.
      const acts = card.ability.length > 0 || card.discount !== undefined
      expect(help.onHire.length > 0).toBe(acts || card.sendsMarkerTo !== null)
      expect(help.onHire.every((p) => blockText(p).length > 0)).toBe(true)
    },
  )

  // A card whose rules are all basics has nothing extra to say, which is the
  // point of filtering the notes rather than printing all of them.
  it('raises a note only where a card has one to raise', () => {
    const bare = DECK.filter((c) => explainCard(c).concepts.length === 0)
    expect(bare.length).toBeLessThan(DECK.length)
  })

  it('names each concept once per card', () => {
    for (const card of DECK) {
      const { concepts } = explainCard(card)
      expect(new Set(concepts).size, card.name).toBe(concepts.length)
    }
  })

  // A note nothing in the deck reaches is a note nobody will ever read, and it
  // would go stale without anything failing.
  it('leaves no concept unreachable', () => {
    const reached = new Set(DECK.flatMap((c) => explainCard(c).concepts))
    expect(CONCEPT_IDS.filter((id) => !reached.has(id))).toEqual([])
  })

  it('describes only concepts it has copy for', () => {
    for (const card of DECK) {
      for (const id of explainCard(card).concepts) {
        expect(CONCEPTS[id], `${card.name} wants ${id}`).toBeTruthy()
      }
    }
  })

  // The prose quotes figures off the card, so a card and its explanation can
  // disagree. These are the two that carry a number the player will check.
  it('quotes the cap and the payout on every budget line', () => {
    const lines = DECK.filter((c) => c.scoring.score === 'budgetLine')
    expect(lines).toHaveLength(11)
    for (const card of lines) {
      const s = card.scoring
      if (s.score !== 'budgetLine') continue
      const help = explainCard(card)
      expect(help.concepts).toContain('budgetLine')
      expect(richText(help.review)).toContain(`${s.cap}k`)
      expect(richText(help.review)).toContain(String(s.cap * s.points))
    }
  })

  it('says what a hire costs', () => {
    const card = DECK.find((c) => c.id === 'ic-icon-designer')!
    expect(richText(explainCard(card).subtitle)).toContain(`${card.cost}k`)
  })
})

// The copy is the deliverable, so it is held to the same rules as the comments
// around it.
describe('help copy', () => {
  const everything = [
    ...Object.values(CONCEPTS).flatMap((c) => [
      c.title,
      ...c.body.map(richText),
    ]),
    ...DECK.flatMap((c) => {
      const h = explainCard(c)
      return [
        richText(h.subtitle),
        richText(h.review),
        ...h.onHire.map(blockText),
      ]
    }),
  ]

  it('uses no dashes and no semicolons', () => {
    const offenders = everything.filter((line) => /[;–—]/.test(line))
    expect(offenders).toEqual([])
  })

  it('splits every note into paragraphs that each end', () => {
    for (const [id, c] of Object.entries(CONCEPTS)) {
      expect(c.body.length, id).toBeGreaterThan(0)
      for (const para of c.body) expect(richText(para), id).toMatch(/[.!?]$/)
    }
  })

  it('ends every sentence', () => {
    const unterminated = DECK.flatMap((c) => {
      const h = explainCard(c)
      return [richText(h.review), ...h.onHire.map(blockText)].filter(
        (line) => !/[.!?]$/.test(line),
      )
    })
    expect(unterminated).toEqual([])
  })
})

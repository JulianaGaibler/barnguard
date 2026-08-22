import { describe, expect, it } from 'vitest'
import { DECK, DECK_BY_ID } from './deck'
import {
  describeAbility,
  describeAbilitySpans,
  describeDetail,
  describeScoring,
  describeScoringSpans,
} from './text'
import { scoreOrg, type Cell } from './scoring'

describe('rules text', () => {
  it('describes the review of every card', () => {
    for (const card of DECK) {
      const text = describeScoring(card)
      expect(text, card.id).toBeTruthy()
      expect(text, card.id).not.toContain('undefined')
    }
  })

  it('describes the ability of every card that has one', () => {
    for (const card of DECK) {
      const text = describeAbility(card)
      if (card.ability.length === 0 && !card.discount) continue
      expect(text, card.id).toBeTruthy()
      expect(text, card.id).not.toContain('undefined')
    }
  })

  it('describes a discount rather than an empty ability', () => {
    expect(
      describeAbility(DECK_BY_ID.get('mgmt-chief-marketing-officer')!),
    ).toBe('Later every hire cost 1k less')
  })

  it('reads all money in thousands', () => {
    for (const card of DECK) {
      const both = describeAbility(card) + ' ' + describeScoring(card)
      expect(both, card.id).not.toMatch(/\$\d/)
    }
  })

  it('marks the numeric values bold in spans', () => {
    // Head of IT Infrastructure: "Add 2k to every budget line OR Gain 3 approvals".
    const spans = describeAbilitySpans(
      DECK_BY_ID.get('mgmt-head-of-it-infrastructure')!,
    )
    expect(spans.map((s) => s.text).join('')).toContain(' OR ')
    expect(spans.some((s) => s.bold && s.text === '3')).toBe(true)
    // A budget review reads its cap as bold "Nk".
    const review = describeScoringSpans(
      DECK_BY_ID.get('mgmt-chief-financial-officer')!,
    )
    expect(review.some((s) => s.bold && /^\d+k$/.test(s.text))).toBe(true)
  })

  it('names the opponent for an ability that reads across the table', () => {
    expect(
      describeAbility(DECK_BY_ID.get('ic-design-systems-designer')!),
    ).toContain("your opponent's")
  })

  it('joins the two halves of a choice', () => {
    expect(
      describeAbility(DECK_BY_ID.get('mgmt-head-of-it-infrastructure')!),
    ).toContain(' OR ')
  })

  it('describes every breakdown line a real board produces', () => {
    const grid: Cell[][] = [[], [], []]
    let i = 0
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) grid[r]![c] = { card: DECK[i++]!, budget: 2 }
    }
    for (const seat of scoreOrg({ grid, approvals: 4 }).seats) {
      if (seat.kind !== 'card') continue
      const line = describeDetail(seat.detail)
      expect(line, seat.id).toBeTruthy()
      expect(line, seat.id).not.toContain('undefined')
    }
  })
})

import { describe, expect, it } from 'vitest'
import {
  eliminationPoints,
  fillBonus,
  livesBonus,
  makeBreakdown,
  timeBonus,
} from './scoring'
import { RULES, SCORING } from './tuning'

describe('jezzball scoring', () => {
  it('awards elimination points per captured cell', () => {
    expect(eliminationPoints(10)).toBe(10 * SCORING.cellPoints)
    expect(eliminationPoints(0)).toBe(0)
  })

  it('pays a fill bonus only above the target percentage', () => {
    expect(fillBonus(RULES.targetPct)).toBe(0)
    expect(fillBonus(RULES.targetPct - 10)).toBe(0)
    expect(fillBonus(RULES.targetPct + 10)).toBe(SCORING.fillBonusPerPct * 10)
  })

  it('decays the time bonus to a floor of zero', () => {
    expect(timeBonus(0)).toBe(SCORING.timeBonusBase)
    const huge = SCORING.timeBonusBase / SCORING.timePenaltyPerSec + 100
    expect(timeBonus(huge)).toBe(0)
  })

  it('scales the lives bonus and never goes negative', () => {
    expect(livesBonus(3)).toBe(3 * SCORING.lifeValue)
    expect(livesBonus(0)).toBe(0)
    expect(livesBonus(-2)).toBe(0)
  })

  it('sums all four components into the total', () => {
    const b = makeBreakdown(100, 20, 50, 2)
    expect(b.livesBonus).toBe(2 * SCORING.lifeValue)
    expect(b.total).toBe(100 + 20 + 50 + 2 * SCORING.lifeValue)
  })
})

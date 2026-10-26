import { describe, expect, it } from 'vitest'
import type { ProgressMark } from '../story/run'
import { planTrail } from './trailPlan'

const step = (current = false): ProgressMark => ({ kind: 'step', current })
const moment = (current = false): ProgressMark => ({ kind: 'moment', current })

describe('planTrail', () => {
  it('rebuilds a row that was empty', () => {
    expect(planTrail([], [step(true)])).toBe('reset')
  })

  it('adds one mark when the visitor moves on', () => {
    expect(planTrail([step(true)], [step(), step(true)])).toBe('add')
    expect(
      planTrail([step(), step(true)], [step(), step(), moment(true)]),
    ).toBe('add')
  })

  it('removes one mark when the visitor goes back', () => {
    expect(planTrail([step(), step(true)], [step(true)])).toBe('remove')
  })

  it('keeps the same marks when only the current one changes', () => {
    expect(planTrail([step(), step(true)], [step(true), step()])).toBe('same')
  })

  it('rebuilds when the marks before the end are not the same kind', () => {
    expect(
      planTrail([step(), step(true)], [moment(), step(), step(true)]),
    ).toBe('reset')
  })

  it('rebuilds a jump of more than one mark', () => {
    expect(planTrail([step(true)], [step(), step(), step(true)])).toBe('reset')
    expect(planTrail([step(), step(), step(true)], [step(true)])).toBe('reset')
  })
})

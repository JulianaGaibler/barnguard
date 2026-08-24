import { describe, expect, it } from 'vitest'
import { moveToward } from './scalar'

describe('moveToward', () => {
  it('steps by the delta while there is further to go', () => {
    expect(moveToward(0, 1, 0.25)).toBe(0.25)
    expect(moveToward(1, 0, 0.25)).toBe(0.75)
  })

  // The whole reason this is not `v + Math.sign(target - v) * maxDelta`: a
  // value chasing a target lands ON it and stays, rather than oscillating
  // across it by a step every frame.
  it('lands on the target rather than passing it, from either side', () => {
    expect(moveToward(0.9, 1, 0.25)).toBe(1)
    expect(moveToward(0.1, 0, 0.25)).toBe(0)
  })

  it('holds still once it is there', () => {
    expect(moveToward(1, 1, 0.25)).toBe(1)
  })

  it('takes a target below and above zero alike', () => {
    expect(moveToward(-1, -3, 0.5)).toBe(-1.5)
    expect(moveToward(-1, 3, 10)).toBe(3)
  })
})

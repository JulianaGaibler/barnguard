import { describe, expect, it } from 'vitest'
import { CONFETTI_COUNT, ConfettiBurst } from './ConfettiBurst'

/** A fixed sequence, so the burst is the same every run. */
function sequence(): () => number {
  let i = 0
  const values = [0.1, 0.9, 0.4, 0.6, 0.25, 0.75, 0.5]
  return () => values[i++ % values.length]
}

describe('ConfettiBurst', () => {
  it('throws out every spark at once', () => {
    const burst = new ConfettiBurst({ x: 960, y: 540 }, sequence())
    expect(burst.flying).toBe(CONFETTI_COUNT)
  })

  it('sits where it was asked to', () => {
    const burst = new ConfettiBurst({ x: 960, y: 540 }, sequence())
    expect(burst.transform.x).toBe(960)
    expect(burst.transform.y).toBe(540)
  })

  it('has every spark gone once the longest life has passed', () => {
    const burst = new ConfettiBurst({ x: 0, y: 0 }, sequence())
    for (let t = 0; t < 2; t += 1 / 60) burst.onUpdate(1 / 60)
    expect(burst.flying).toBe(0)
  })

  it('keeps some sparks flying partway through', () => {
    const burst = new ConfettiBurst({ x: 0, y: 0 }, sequence())
    for (let t = 0; t < 0.5; t += 1 / 60) burst.onUpdate(1 / 60)
    expect(burst.flying).toBe(CONFETTI_COUNT)
  })
})

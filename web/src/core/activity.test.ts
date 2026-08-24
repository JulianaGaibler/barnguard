import { afterEach, describe, expect, it, vi } from 'vitest'
import { msSinceInput, pokeActivity, startActivityTracking } from './activity'

let detach: (() => void) | null = null

afterEach(() => {
  detach?.()
  detach = null
  vi.useRealTimers()
})

describe('msSinceInput', () => {
  it('grows with the clock and resets on a poke', () => {
    vi.useFakeTimers()
    pokeActivity()
    vi.advanceTimersByTime(5000)
    expect(msSinceInput()).toBeGreaterThanOrEqual(5000)
    pokeActivity()
    expect(msSinceInput()).toBeLessThan(5000)
  })
})

describe('startActivityTracking', () => {
  it('counts input on window until detached', () => {
    vi.useFakeTimers()
    detach = startActivityTracking()

    vi.advanceTimersByTime(5000)
    window.dispatchEvent(new Event('pointerdown'))
    expect(msSinceInput()).toBeLessThan(5000)

    detach()
    detach = null
    vi.advanceTimersByTime(5000)
    window.dispatchEvent(new Event('pointerdown'))
    expect(msSinceInput()).toBeGreaterThanOrEqual(5000)
  })
})

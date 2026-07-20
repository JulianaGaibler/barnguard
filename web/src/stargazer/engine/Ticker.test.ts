import { describe, expect, it } from 'vitest'
import { createTicker } from './Ticker'

describe('Ticker FPS cap', () => {
  it('is uncapped by default', () => {
    expect(createTicker().maxFps).toBe(0)
  })

  it('reports the configured cap', () => {
    expect(createTicker({ maxFps: 60 }).maxFps).toBe(60)
  })

  it('setMaxFps updates the cap and 0 clears it', () => {
    const t = createTicker()
    t.setMaxFps(120)
    expect(Math.round(t.maxFps)).toBe(120)
    t.setMaxFps(0)
    expect(t.maxFps).toBe(0)
    t.setMaxFps(-5)
    expect(t.maxFps).toBe(0)
  })

  it('does not affect the fixed step rate', () => {
    const t = createTicker({ fixedStepHz: 120, maxFps: 30 })
    expect(t.fixedDt).toBeCloseTo(1 / 120, 10)
  })
})

describe('Ticker delta smoothing', () => {
  it('is on by default', () => {
    expect(createTicker().smoothTimestep).toBe(true)
  })

  it('honors the opt-out and toggles at runtime', () => {
    const t = createTicker({ smoothTimestep: false })
    expect(t.smoothTimestep).toBe(false)
    t.setSmoothTimestep(true)
    expect(t.smoothTimestep).toBe(true)
  })
})

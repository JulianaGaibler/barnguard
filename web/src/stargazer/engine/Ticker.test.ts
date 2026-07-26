import { afterEach, describe, expect, it, vi } from 'vitest'
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

describe('Ticker rawDt (true frame interval for FPS)', () => {
  const origRaf = globalThis.requestAnimationFrame
  const origCancel = globalThis.cancelAnimationFrame

  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf
    globalThis.cancelAnimationFrame = origCancel
    vi.restoreAllMocks()
  })

  it('reports the unclamped interval while dt stays clamped to maxDt', () => {
    // Capture the loop callback instead of really scheduling it.
    let loop: FrameRequestCallback | null = null
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      loop = cb
      return 1
    }) as typeof requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
    // `start()` seeds #lastMs from performance.now(); pin it to 1000.
    vi.spyOn(performance, 'now').mockReturnValue(1000)

    // Smoothing off so `dt` is deterministic; default maxDt = 1/30 s.
    const t = createTicker({ smoothTimestep: false })
    t.start()

    // A 100 ms frame (a real 10 FPS stall): rawDt = 0.1, dt clamps to 1/30.
    loop!(1100)
    expect(t.rawDt).toBeCloseTo(0.1, 5)
    expect(t.dt).toBeCloseTo(1 / 30, 5)
    // 1 / dt would report 30 FPS (the clamp floor); 1 / rawDt reports the true 10.
    expect(1 / t.rawDt).toBeCloseTo(10, 3)

    // A healthy 60 FPS frame: rawDt and dt agree (interval under the clamp).
    loop!(1100 + 1000 / 60)
    expect(t.rawDt).toBeCloseTo(1 / 60, 5)
    expect(t.dt).toBeCloseTo(1 / 60, 5)
  })
})

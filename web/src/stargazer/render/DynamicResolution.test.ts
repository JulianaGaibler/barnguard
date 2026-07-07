import { describe, it, expect } from 'vitest'
import {
  DynamicResolution,
  type DynamicResolutionOptions,
} from './DynamicResolution'

function opts(
  over: Partial<DynamicResolutionOptions> = {},
): DynamicResolutionOptions {
  return {
    enabled: true,
    motionScale: 0.6,
    minScale: 0.4,
    highWatermarkMs: 18,
    lowWatermarkMs: 13,
    evalIntervalFrames: 5,
    settleDwellMs: 100,
    settleStepFrames: 3,
    ...over,
  }
}

describe('DynamicResolution', () => {
  it('returns 1 unconditionally when disabled', () => {
    const dr = new DynamicResolution(opts({ enabled: false }))
    expect(dr.update(0, true)).toBe(1)
    expect(dr.update(16, false)).toBe(1)
    expect(dr.update(999, true)).toBe(1)
  })

  it('drops to motionScale while the camera is moving', () => {
    const dr = new DynamicResolution(opts())
    expect(dr.update(0, false)).toBeCloseTo(1)
    expect(dr.update(16, true)).toBeCloseTo(0.6)
    expect(dr.update(32, true)).toBeCloseTo(0.6)
  })

  it('holds the low scale through the settle dwell, then ramps back up', () => {
    const dr = new DynamicResolution(opts())
    dr.update(0, false)
    dr.update(16, true)
    dr.update(32, true) // moving → 0.6

    // Motion stops → dwell (dwellUntil = 48 + 100 = 148); low scale held.
    expect(dr.update(48, false)).toBeCloseTo(0.6)
    expect(dr.update(120, false)).toBeCloseTo(0.6) // still < 148

    // Past the dwell → staggered step-up 0.6 → … → 1 over 3 frames.
    const s1 = dr.update(160, false)
    const s2 = dr.update(176, false)
    const s3 = dr.update(192, false)
    expect(s1).toBeGreaterThan(0.6)
    expect(s1).toBeLessThan(1)
    expect(s2).toBeGreaterThan(s1)
    expect(s3).toBeCloseTo(1)

    // Settled → steady at the baseline.
    expect(dr.update(208, false)).toBeCloseTo(1)
  })

  it('governor steps the baseline down under sustained slow frames', () => {
    const dr = new DynamicResolution(opts())
    let t = 0
    for (let i = 0; i < 20; i++) {
      dr.update(t, false) // 25ms/frame → EMA ≈ 25ms > highWatermark
      t += 25
    }
    expect(dr.smoothedFrameMs).toBeGreaterThan(18)
    expect(dr.baseline).toBeLessThan(1)
    expect(dr.baseline).toBeGreaterThanOrEqual(0.4) // never below minScale
  })

  it('does not run the governor while the camera is moving', () => {
    const dr = new DynamicResolution(opts())
    let t = 0
    for (let i = 0; i < 20; i++) {
      dr.update(t, true) // slow frames, but all during motion
      t += 25
    }
    expect(dr.baseline).toBe(1) // governor gated off → baseline untouched
  })

  it('governor recovers the baseline once frames are fast again', () => {
    const dr = new DynamicResolution(opts())
    let t = 0
    for (let i = 0; i < 20; i++) {
      dr.update(t, false)
      t += 25
    }
    const low = dr.baseline
    expect(low).toBeLessThan(1)
    for (let i = 0; i < 200; i++) {
      dr.update(t, false) // 6ms/frame → EMA well under lowWatermark
      t += 6
    }
    expect(dr.baseline).toBeGreaterThan(low)
  })
})

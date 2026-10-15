import { describe, expect, it } from 'vitest'
import { THRESHOLDS, toneFor, worseTone } from './thresholds'

describe('toneFor', () => {
  it('is good up to good, warn up to warn, and bad above', () => {
    const t = THRESHOLDS.drawCalls
    expect(toneFor(t, 0)).toBe('good')
    expect(toneFor(t, t.good)).toBe('good')
    expect(toneFor(t, t.good + 1)).toBe('warn')
    expect(toneFor(t, t.warn)).toBe('warn')
    expect(toneFor(t, t.warn + 1)).toBe('bad')
  })

  it('runs the other way when a high reading is the healthy one', () => {
    const t = THRESHOLDS.cacheHitRate
    expect(toneFor(t, 0.99)).toBe('good')
    expect(toneFor(t, 0.7)).toBe('warn')
    expect(toneFor(t, 0.3)).toBe('bad')
  })

  it('treats any stale picture or label page reset as bad', () => {
    expect(toneFor(THRESHOLDS.stalePictures, 0)).toBe('good')
    expect(toneFor(THRESHOLDS.stalePictures, 1)).toBe('bad')
    expect(toneFor(THRESHOLDS.labelPageResets, 1)).toBe('bad')
  })

  it('explains every metric', () => {
    for (const t of Object.values(THRESHOLDS)) {
      expect(t.tip.length).toBeGreaterThan(20)
    }
  })
})

describe('worseTone', () => {
  it('picks the worse of two', () => {
    expect(worseTone('good', 'warn')).toBe('warn')
    expect(worseTone('bad', 'warn')).toBe('bad')
    expect(worseTone('neutral', 'good')).toBe('good')
  })
})

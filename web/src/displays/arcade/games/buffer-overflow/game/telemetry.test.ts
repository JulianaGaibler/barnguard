import { describe, expect, it } from 'vitest'
import { seededRandom } from '../../common/rng'
import {
  createHistory,
  createTelemetry,
  historyMean,
  historyPeak,
  JOB_LABELS,
  loadFor,
  stepHistory,
  stepTelemetry,
} from './telemetry'

const LABELS = ['cpu0', 'cpu1', 'cpu2', 'mem']

/** Run `seconds` of clock at a steady frame time. */
const run = (
  t: ReturnType<typeof createTelemetry>,
  seconds: number,
  load = 0,
): void => {
  for (let i = 0; i < seconds * 60; i++) stepTelemetry(t, 1 / 60, load)
}

describe('loadFor', () => {
  it('runs from nothing at level one to everything at the cap', () => {
    expect(loadFor(1, 20)).toBe(0)
    expect(loadFor(20, 20)).toBe(1)
    expect(loadFor(10, 20)).toBeCloseTo(9 / 19, 6)
  })

  it('clamps rather than reporting a level past the cap', () => {
    expect(loadFor(99, 20)).toBe(1)
    expect(loadFor(-4, 20)).toBe(0)
  })
})

describe('createTelemetry', () => {
  it('is deterministic from its seed, so a run replays', () => {
    const a = createTelemetry(LABELS, 42)
    const b = createTelemetry(LABELS, 42)
    run(a, 30)
    run(b, 30)
    expect(a.gauges.map((g) => g.value)).toEqual(b.gauges.map((g) => g.value))
    expect(a.job.progress).toBe(b.job.progress)
  })

  it('starts its meters already spread out', () => {
    // Otherwise every column rises from empty in lockstep on the first frame,
    // which is the one moment the decoration would be the loudest thing on
    // screen.
    const t = createTelemetry(LABELS, 7)
    expect(new Set(t.gauges.map((g) => g.value)).size).toBeGreaterThan(1)
    for (const g of t.gauges) expect(g.value).toBeGreaterThan(0)
  })
})

describe('stepTelemetry', () => {
  it('keeps every reading on the scale', () => {
    const t = createTelemetry(LABELS, 3)
    for (let i = 0; i < 60; i++) {
      run(t, 5, i % 2)
      for (const g of t.gauges) {
        expect(g.value).toBeGreaterThanOrEqual(0)
        expect(g.value).toBeLessThanOrEqual(1)
      }
    }
  })

  it('never moves a meter faster than its rate, whatever the jump', () => {
    // The whole point of the decoration is that it does not pull the eye. A
    // meter that snapped would.
    const t = createTelemetry(LABELS, 11)
    let last = t.gauges.map((g) => g.value)
    for (let i = 0; i < 600; i++) {
      stepTelemetry(t, 1 / 60, 1)
      t.gauges.forEach((g, j) => {
        expect(Math.abs(g.value - last[j])).toBeLessThanOrEqual(
          0.55 / 60 + 1e-9,
        )
      })
      last = t.gauges.map((g) => g.value)
    }
  })

  it('runs hotter as the game speeds up', () => {
    const idle = createTelemetry(LABELS, 5)
    const busy = createTelemetry(LABELS, 5)
    run(idle, 120, 0)
    run(busy, 120, 1)
    const mean = (t: typeof idle): number =>
      t.gauges.reduce((sum, g) => sum + g.value, 0) / t.gauges.length
    expect(mean(busy)).toBeGreaterThan(mean(idle))
  })

  it('ignores a frame that did not advance', () => {
    const t = createTelemetry(LABELS, 9)
    const before = t.gauges.map((g) => g.value)
    stepTelemetry(t, 0, 0.5)
    expect(t.gauges.map((g) => g.value)).toEqual(before)
  })

  it('creeps the build to done, rests, then starts the next one', () => {
    const t = createTelemetry(LABELS, 2)
    const first = t.job.label
    run(t, 10)
    // Slow enough that ten seconds is a fraction of it, which is the whole
    // reason a build is the right thing to put in a decorative column.
    expect(t.job.progress).toBeGreaterThan(0)
    expect(t.job.progress).toBeLessThan(0.35)

    run(t, 70)
    expect(t.job.label).not.toBe(first)
    expect(JOB_LABELS).toContain(t.job.label)
    expect(t.job.progress).toBeLessThan(1)
  })
})

describe('the history graph', () => {
  it('opens already full, so the pane is a graph from the first frame', () => {
    const h = createHistory(40, 4)
    expect(h.samples).toHaveLength(40)
    for (const v of h.samples) expect(v).toBeGreaterThan(0)
  })

  it('takes a sample only every second or so, not every frame', () => {
    const h = createHistory(40, 4)
    const random = seededRandom(4)
    const first = [...h.samples]
    for (let i = 0; i < 30; i++) stepHistory(h, 1 / 60, 0.5, random)
    // Half a second of frames, and the window has not moved.
    expect(h.samples).toEqual(first)
  })

  it('scrolls one bar at a time, dropping the oldest', () => {
    const h = createHistory(6, 4)
    const random = seededRandom(4)
    const before = [...h.samples]
    for (let i = 0; i < 60 * 1.5; i++) stepHistory(h, 1 / 60, 0.5, random)
    expect(h.samples).toHaveLength(6)
    expect(h.samples.slice(0, 5)).toEqual(before.slice(1))
  })

  it('reports a peak and a mean inside the range', () => {
    const h = createHistory(20, 8)
    const peak = historyPeak(h)
    const mean = historyMean(h)
    expect(peak).toBeGreaterThanOrEqual(mean)
    expect(peak).toBeLessThanOrEqual(1)
    expect(mean).toBeGreaterThan(0)
  })

  it('has no peak or mean to report when it is empty', () => {
    const empty = {
      samples: [],
      capacity: 0,
      since: 0,
      gauge: createHistory(1, 1).gauge,
    }
    expect(historyPeak(empty)).toBe(0)
    expect(historyMean(empty)).toBe(0)
  })
})

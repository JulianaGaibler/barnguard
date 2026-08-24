/**
 * The ambient readings in the two side columns: core meters that drift, process
 * rows that tick over, and one build that creeps along and starts again.
 *
 * None of it is load-bearing. It exists because a solo game has a whole region
 * to itself and the buffer cannot grow into it, so the alternative to filling
 * that space is leaving it empty. What fills it should look like the rest of
 * the machine the game is pretending to run on.
 *
 * Two rules keep decoration from becoming noise:
 *
 * Nothing moves quickly. A meter picks a new target every few seconds and eases
 * toward it over more than a second, and the build takes the better part of a
 * minute. Anything faster would pull the eye off the buffer, which is the one
 * thing this must never do.
 *
 * Everything is driven by the level. The machine warms as the game speeds up,
 * so the columns are telling the truth about something even though nothing
 * depends on them.
 *
 * Pure and seeded, so a run replays identically and none of it needs a canvas
 * to test.
 */
import { seededRandom, type Random } from '../../common/rng'
import { clamp } from '@src/stargazer'

/** Seconds a meter holds a target before choosing another. */
const HOLD_MIN = 2.6
const HOLD_MAX = 7
/** How fast a meter closes on its target, in units of full scale per second. */
const EASE_PER_SEC = 0.55
/** Seconds one build takes, and how long it rests before the next. */
const JOB_MIN_SEC = 38
const JOB_MAX_SEC = 62
const JOB_REST_SEC = 3.5

/**
 * What a build is called.
 *
 * Plausible output from a toolchain, and deliberately about this game's own
 * fiction rather than anything real.
 */
export const JOB_LABELS: readonly string[] = [
  'cc buffer.c',
  'link bufferd',
  'test rules',
  'pack assets',
  'strip symbols',
  'fmt sources',
]

/** A drifting reading, `0` to `1`. */
export interface Gauge {
  label: string
  value: number
  target: number
  /** Seconds left before it picks a new target. */
  hold: number
}

/** The build that creeps along the bottom of the right column. */
export interface Job {
  label: string
  /** `0` to `1`. Sits at `1` through the rest before the next one starts. */
  progress: number
  elapsed: number
  duration: number
  /** Seconds spent finished. Counts up only once `progress` reaches one. */
  resting: number
  index: number
}

export interface Telemetry {
  gauges: Gauge[]
  job: Job
  random: Random
}

/** Seconds between two samples of the history graph. */
const SAMPLE_SEC = 1.4

/**
 * A rolling window of past readings, oldest first.
 *
 * The graph is the one thing out here that draws the eye on purpose, so it
 * moves in discrete steps rather than sliding: a bar appears at the right every
 * second and a bit, and nothing between those moments changes at all. A
 * continuous scroll would be motion on every single frame.
 */
export interface History {
  samples: number[]
  capacity: number
  since: number
  /** The live reading, which drifts between samples like any other meter. */
  gauge: Gauge
}

export function createHistory(capacity: number, seed: number): History {
  const random = seededRandom(seed)
  const gauge: Gauge = {
    label: 'load',
    value: pickTarget(random, 0),
    target: pickTarget(random, 0),
    hold: pickHold(random),
  }
  // Pre-filled, so the pane opens as a graph with a past rather than as an
  // empty box that takes a minute to become one.
  const samples: number[] = []
  for (let i = 0; i < capacity; i++) samples.push(pickTarget(random, 0))
  return { samples, capacity, since: 0, gauge }
}

/** Advance the live reading, and take a sample when one is due. */
export function stepHistory(
  h: History,
  dt: number,
  load: number,
  random: Random,
): void {
  if (dt <= 0) return
  const g = h.gauge
  g.hold -= dt
  if (g.hold <= 0) {
    g.target = pickTarget(random, load)
    g.hold = pickHold(random)
  }
  const step = EASE_PER_SEC * dt
  const delta = g.target - g.value
  g.value += Math.abs(delta) <= step ? delta : Math.sign(delta) * step

  h.since += dt
  if (h.since < SAMPLE_SEC) return
  h.since -= SAMPLE_SEC
  h.samples.push(g.value)
  while (h.samples.length > h.capacity) h.samples.shift()
}

/** The tallest reading in the window. */
export function historyPeak(h: History): number {
  let peak = 0
  for (const v of h.samples) if (v > peak) peak = v
  return peak
}

/** The mean reading across the window. */
export function historyMean(h: History): number {
  if (h.samples.length === 0) return 0
  let total = 0
  for (const v of h.samples) total += v
  return total / h.samples.length
}

/** How hard the machine is working, `0` to `1`, from the level. */
export function loadFor(level: number, maxLevel: number): number {
  if (maxLevel <= 1) return 0
  return clamp((level - 1) / (maxLevel - 1), 0, 1)
}

/** Where a meter aims next, biased up by how hard the game is working. */
function pickTarget(random: Random, load: number): number {
  return clamp(0.06 + random() * 0.5 + load * 0.4, 0.03, 0.97)
}

function pickHold(random: Random): number {
  return HOLD_MIN + random() * (HOLD_MAX - HOLD_MIN)
}

export function createTelemetry(
  labels: readonly string[],
  seed: number,
): Telemetry {
  const random = seededRandom(seed)
  const gauges = labels.map((label) => ({
    label,
    // Started already spread out, so the column does not rise from empty in
    // lockstep on the first frame of every run.
    value: pickTarget(random, 0),
    target: pickTarget(random, 0),
    hold: pickHold(random),
  }))
  return {
    gauges,
    job: {
      label: JOB_LABELS[0],
      progress: 0,
      elapsed: 0,
      duration: JOB_MIN_SEC + random() * (JOB_MAX_SEC - JOB_MIN_SEC),
      resting: 0,
      index: 0,
    },
    random,
  }
}

/** Advance every reading by `dt`, at the working level `load` implies. */
export function stepTelemetry(t: Telemetry, dt: number, load: number): void {
  if (dt <= 0) return
  const step = EASE_PER_SEC * dt
  for (const g of t.gauges) {
    g.hold -= dt
    if (g.hold <= 0) {
      g.target = pickTarget(t.random, load)
      g.hold = pickHold(t.random)
    }
    // Rate limited rather than proportional, so every meter moves at the same
    // speed whatever distance it has to cover and none of them snaps.
    const delta = g.target - g.value
    g.value += Math.abs(delta) <= step ? delta : Math.sign(delta) * step
  }
  stepJob(t, dt)
}

function stepJob(t: Telemetry, dt: number): void {
  const job = t.job
  if (job.progress >= 1) {
    job.resting += dt
    if (job.resting < JOB_REST_SEC) return
    job.index = (job.index + 1) % JOB_LABELS.length
    job.label = JOB_LABELS[job.index]
    job.progress = 0
    job.elapsed = 0
    job.resting = 0
    job.duration = JOB_MIN_SEC + t.random() * (JOB_MAX_SEC - JOB_MIN_SEC)
    return
  }
  job.elapsed += dt
  job.progress = Math.min(1, job.elapsed / job.duration)
}

/**
 * Trajectory prediction for fair spawning. A spawn candidate is a position, a
 * heading and a speed. Each live packet's path over the next few seconds is
 * predicted as a `Track`, sampled at fixed time steps, and a candidate is safe
 * when its own track keeps a minimum distance from every other track at every
 * shared step.
 *
 * A free packet flies straight, a routed packet follows its drawn trail and
 * then its last direction. A track ends where the path leaves the predictable
 * area, since past the border a packet is lost and near the viewport edge the
 * border turnaround bends it in ways this model does not follow.
 *
 * Pure geometry with no engine state, so `SpawnController` feeds it plain
 * numbers and the tests drive it directly.
 */
import type { Vec2 } from 'stargazer'

/** Predicted positions at `stepSec` intervals, from step 0 to `steps - 1`. */
export interface Track {
  /** Interleaved `x, y` per step. */
  readonly xy: Float32Array
  /** Steps with a known position. The packet's path is unknown after these. */
  readonly steps: number
}

export interface PredictionClock {
  horizonSec: number
  stepSec: number
}

/** Where a path can be predicted. Outside it, the track ends. */
export type PredictableArea = (x: number, y: number) => boolean

/** The waypoints of a drawn trail, read without copying. */
export interface TrailPoints {
  readonly pointCount: number
  pointAt(index: number, out: Vec2): Vec2
}

function stepCount(clock: PredictionClock): number {
  return Math.floor(clock.horizonSec / clock.stepSec) + 1
}

/**
 * A packet that holds still for `holdSec`, then flies straight along `heading`
 * at `speed`.
 */
export function predictLine(
  start: Vec2,
  headingRad: number,
  speed: number,
  holdSec: number,
  area: PredictableArea,
  clock: PredictionClock,
): Track {
  const total = stepCount(clock)
  const xy = new Float32Array(total * 2)
  const dx = Math.cos(headingRad)
  const dy = Math.sin(headingRad)
  let steps = 0
  for (; steps < total; steps++) {
    const moving = Math.max(0, steps * clock.stepSec - holdSec)
    const x = start.x + dx * speed * moving
    const y = start.y + dy * speed * moving
    if (!area(x, y)) break
    xy[steps * 2] = x
    xy[steps * 2 + 1] = y
  }
  return { xy, steps }
}

/**
 * A packet routed along `trail`, heading for the point at `fromIndex`. Once the
 * trail runs out it keeps the direction of the last leg it travelled, or its
 * `velocity` when it travelled none, as the steering does.
 */
export function predictAlongTrail(
  start: Vec2,
  velocity: Vec2,
  speed: number,
  trail: TrailPoints,
  fromIndex: number,
  area: PredictableArea,
  clock: PredictionClock,
): Track {
  const total = stepCount(clock)
  const xy = new Float32Array(total * 2)
  const point: Vec2 = { x: 0, y: 0 }
  const velocityLength = Math.hypot(velocity.x, velocity.y)
  let dirX = velocityLength > 1e-6 ? velocity.x / velocityLength : 0
  let dirY = velocityLength > 1e-6 ? velocity.y / velocityLength : 0
  let x = start.x
  let y = start.y
  let next = fromIndex
  const stride = speed * clock.stepSec
  let steps = 0
  for (; steps < total; steps++) {
    if (steps > 0) {
      let budget = stride
      while (budget > 0 && next < trail.pointCount) {
        trail.pointAt(next, point)
        const legX = point.x - x
        const legY = point.y - y
        const leg = Math.hypot(legX, legY)
        if (leg > 1e-6) {
          dirX = legX / leg
          dirY = legY / leg
        }
        if (leg > budget) break
        x = point.x
        y = point.y
        budget -= leg
        next++
      }
      x += dirX * budget
      y += dirY * budget
    }
    if (!area(x, y)) break
    xy[steps * 2] = x
    xy[steps * 2 + 1] = y
  }
  return { xy, steps }
}

/**
 * The closest `candidate` comes to any of `others` at a shared step, or
 * `Infinity` when no steps are shared. Stops early once it falls below
 * `stopBelow`, since the candidate is rejected either way.
 */
export function minSeparation(
  candidate: Track,
  others: readonly Track[],
  stopBelow = 0,
): number {
  let closestSq = Infinity
  const stopSq = stopBelow * stopBelow
  for (const other of others) {
    const shared = Math.min(candidate.steps, other.steps)
    for (let i = 0; i < shared; i++) {
      const dx = candidate.xy[i * 2] - other.xy[i * 2]
      const dy = candidate.xy[i * 2 + 1] - other.xy[i * 2 + 1]
      const distSq = dx * dx + dy * dy
      if (distSq < closestSq) {
        closestSq = distSq
        if (closestSq < stopSq) return Math.sqrt(closestSq)
      }
    }
  }
  return Math.sqrt(closestSq)
}

export interface SpawnCandidate {
  /** Closest approach to any live packet's track. */
  separation: number
  /** Border-clear distance ahead along the heading. */
  runway: number
}

/**
 * Whether `a` is a fairer spawn than `b`. Separation counts up to `required`,
 * so between two safe candidates the longer runway wins.
 */
export function isFairer(
  a: SpawnCandidate,
  b: SpawnCandidate,
  required: number,
): boolean {
  const sepA = Math.min(a.separation, required)
  const sepB = Math.min(b.separation, required)
  if (sepA !== sepB) return sepA > sepB
  return a.runway > b.runway
}

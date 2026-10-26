import type { Vec2 } from 'stargazer'

export interface RouteInput {
  /** Where the packet is now. */
  from: Vec2
  /** The target the route has to end on. */
  apex: Vec2
  /** Direction from the apex out through the middle of the cone's mouth. */
  axisRad: number
  /** How far the cone reaches from the apex. */
  coneRadius: number
  /** The most space between two points on the route. */
  spacing: number
}

export interface RouteOptions {
  /**
   * Stop partway so the packet never arrives, which is how the attract mode
   * loses a round now and then.
   */
  fumble: boolean
}

/** How far outside the cone the route turns in, as a multiple of its reach. */
const ENTRY_REACH = 1.1
/** How far the curve bows, as a fraction of the distance it covers. */
const BOW_FRACTION = 0.25
/** Part of the route a fumbled one covers, from this much to this much. */
const FUMBLE_MIN = 0.45
const FUMBLE_MAX = 0.8

/** `steps` points from `a` to `b`, `a` left out and `b` included. */
function lineTo(a: Vec2, b: Vec2, spacing: number, out: Vec2[]): void {
  const steps = Math.max(
    1,
    Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / spacing),
  )
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  }
}

/**
 * The points a hand would draw to bring a packet into its target: a bowed curve
 * to a spot just outside the cone's mouth, then straight in to the apex.
 *
 * Points are spaced no further apart than `spacing`, since a packet steers to
 * each point in turn and skips none it passes close enough to. `rng` returns
 * numbers in `[0, 1)`, and is the route's only source of variation.
 *
 * @example
 *   const route = planRoute(input, Math.random, { fumble: false })
 *   for (const p of route) trail.push(p.x, p.y)
 */
export function planRoute(
  input: RouteInput,
  rng: () => number,
  options: RouteOptions,
): Vec2[] {
  const { from, apex, axisRad, coneRadius, spacing } = input
  const entry: Vec2 = {
    x: apex.x + Math.cos(axisRad) * coneRadius * ENTRY_REACH,
    y: apex.y + Math.sin(axisRad) * coneRadius * ENTRY_REACH,
  }

  const dx = entry.x - from.x
  const dy = entry.y - from.y
  const dist = Math.hypot(dx, dy)
  const side = rng() < 0.5 ? -1 : 1
  const bow = dist * BOW_FRACTION * (0.5 + rng()) * side
  const control: Vec2 =
    dist > 0
      ? {
          x: from.x + dx / 2 + (-dy / dist) * bow,
          y: from.y + dy / 2 + (dx / dist) * bow,
        }
      : { ...from }

  const points: Vec2[] = []
  // A curve is longer than its chord, so sample it finely enough that the
  // chord of each piece stays within `spacing`.
  const steps = Math.max(1, Math.ceil((dist * 1.4) / spacing))
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    const u = 1 - t
    points.push({
      x: u * u * from.x + 2 * u * t * control.x + t * t * entry.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * entry.y,
    })
  }
  lineTo(entry, apex, spacing, points)

  if (!options.fumble) return points
  const keep = Math.max(
    1,
    Math.floor(
      points.length * (FUMBLE_MIN + rng() * (FUMBLE_MAX - FUMBLE_MIN)),
    ),
  )
  return points.slice(0, keep)
}

/**
 * How the story screens move. Every duration, distance and curve is here, so
 * the feel is tuned in one place. The helpers below are pure and the nodes and
 * the director call them.
 */

/** Seconds, unless a name says otherwise. */
export const MOTION = {
  /** A tapped answer's square sinks and a release lifts it. */
  press: 0.12,
  pressScale: 0.96,
  /** The picked square turns into a circle and goes red. */
  morph: 0.28,
  /** The circle's flight to the progress row. */
  fly: 0.5,
  /** The answers that were not picked leave. */
  dismiss: 0.24,
  dismissStagger: 0.03,
  dismissDistance: 90,
  /** The story waits this long for the splash to clear before it comes in. */
  handoff: 0.3,
  /** A screen leaves, and the next one comes in. */
  leave: 0.3,
  enter: 0.65,
  /** Design pixels a screen travels as it leaves and as it arrives. */
  slideDistance: 160,
  /** The buttons travel less than the content. */
  navDistance: 60,
  /** How far apart, as a fraction of the whole, parts of one screen start. */
  spread: 0.15,
  /** The answers arrive one after another. */
  tileStagger: 0.04,
  tile: 0.5,
  /** A new mark in the progress row. */
  markPop: 0.42,
  linkGrow: 0.25,
  /** The progress row as a whole slides in or out. */
  trail: 0.5,
  trailDistance: 40,
  /** The background moves to its next pose, and its dots swell meanwhile. */
  background: 1.4,
  /** The warm circle of a touch grows and fades away. */
  touch: 7,
  /** The background blends from one mood to the next. */
  mood: 3.6,
  /** The ending fades the display to black, and then waits in the dark. */
  fadeOut: 3.5,
  linger: 2.2,
  /** The black holds this long before the next screen cuts in. */
  cutHold: 0.7,
  /** The splash comes up out of the black. */
  fadeIn: 1.6,
  swell: 0.5,
} as const

export interface Point {
  x: number
  y: number
}

/** Linear interpolation. */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/**
 * A point on the curve a flying mark follows from `from` to `to` at `t` in
 * 0..1. The curve is a quadratic Bezier, which reads as a swoosh rather than a
 * diagonal. With `'up-first'` it leaves `from` straight up and arrives `to`
 * straight along the row. With `'across-first'`, for a one column screen, it
 * leaves `from` straight across and arrives `to` straight up.
 */
export function flightPoint(
  from: Point,
  to: Point,
  t: number,
  order: 'up-first' | 'across-first' = 'up-first',
): Point {
  const control =
    order === 'up-first' ? { x: from.x, y: to.y } : { x: to.x, y: from.y }
  const u = 1 - t
  return {
    x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
    y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
  }
}

/**
 * How far part `index` of `count` has got when the whole has reached
 * `progress`, both in 0..1. The parts start `spread` of the whole apart, so a
 * single progress value drives a stagger.
 */
export function staggered(
  progress: number,
  index: number,
  count: number,
  spread: number = MOTION.spread,
): number {
  if (count <= 1) return progress
  // Each part runs for 1 - spread of the whole, starting spread/(count-1) apart.
  const length = 1 - spread
  const start = (index * spread) / (count - 1)
  return Math.min(1, Math.max(0, (progress - start) / length))
}

/** Which way a screen travels: 1 goes forward, -1 goes back. */
export type Direction = 1 | -1

/**
 * The horizontal offset of a part that is `v` of the way in, where 0 is hidden
 * and 1 is in place. A part arriving going forward starts to the right (`side`
 * 1), and one leaving going forward ends to the left (`side` -1).
 */
export function slideOffset(side: Direction, v: number, distance: number) {
  return side * (1 - v) * distance
}

// --- the background ----------------------------------------------------------

/** One spot of the background. */
export interface SpotPose {
  /**
   * Where on the edge of the visible area the spot is centered. A whole number
   * is a corner (0 top left, 1 top right, 2 bottom right, 3 bottom left) and
   * the fraction is how far along the edge to the next corner. It wraps at 4.
   */
  u: number
  /** Design pixels. */
  radius: number
  /** 0 hides the spot and 1 is full strength. */
  strength: number
}

/** The two dark spots and the one accent spot that only a moment lights. */
export interface Pose {
  spots: readonly [SpotPose, SpotPose]
  accent: SpotPose
}

/** The period of `SpotPose.u`. */
export const EDGE_LOOP = 4

/** The shortest signed way from `from` to `to` around the loop. */
export function loopDelta(from: number, to: number): number {
  const half = EDGE_LOOP / 2
  const raw = (((to - from) % EDGE_LOOP) + EDGE_LOOP) % EDGE_LOOP
  return raw > half ? raw - EDGE_LOOP : raw
}

/** `u` brought into 0..4. */
export const wrapEdge = (u: number): number =>
  ((u % EDGE_LOOP) + EDGE_LOOP) % EDGE_LOOP

/** The smallest a spot gets, as a fraction of its radius, away from a corner. */
const EDGE_SIZE = 0.28

/**
 * How big a spot is at `u`, as a fraction of its radius: full at a corner and
 * smallest halfway along a side. A spot swells as it reaches a corner and
 * shrinks as it slides along a side, so it orbits the screen without ever
 * reaching in over the text, which is clear of the corners and not the sides.
 */
export function edgeSize(u: number): number {
  const along = wrapEdge(u) % 1
  const cornerness = 1 - 2 * Math.min(along, 1 - along)
  return EDGE_SIZE + (1 - EDGE_SIZE) * cornerness * cornerness
}

/**
 * How big a spot may be at each corner, as a fraction of its radius: top left,
 * top right, bottom right, bottom left. The progress row sits in the top left
 * and the buttons in the bottom corners, so spots there stay small enough to
 * leave them clear, and the empty top right can take a full one.
 */
const CORNER_SIZE = [0.55, 1, 0.45, 1] as const

/** `CORNER_SIZE` blended between the two corners `u` lies between. */
export function cornerSize(u: number): number {
  const loop = wrapEdge(u)
  const corner = Math.floor(loop)
  return lerp(
    CORNER_SIZE[corner],
    CORNER_SIZE[(corner + 1) % EDGE_LOOP],
    loop - corner,
  )
}

/** How big a spot at `u` is, as a fraction of its radius. */
export const spotSize = (u: number): number => cornerSize(u) * edgeSize(u)

/**
 * The point on the edge of a `width` by `height` area for `u`, from its top
 * left corner. The spot sits on the perimeter, so it travels around the screen
 * and never across the text in the middle.
 */
export function edgePoint(u: number, width: number, height: number): Point {
  const loop = wrapEdge(u)
  const edge = Math.floor(loop)
  const along = loop - edge
  switch (edge) {
    case 0:
      return { x: width * along, y: 0 }
    case 1:
      return { x: width, y: height * along }
    case 2:
      return { x: width * (1 - along), y: height }
    default:
      return { x: 0, y: height * (1 - along) }
  }
}

/** How far past the edge of the visible area a spot is centered. */
export const OVERSHOOT = 80

/**
 * Where the spot at `u` is centered for a `width` by `height` area: on its edge
 * and pushed `OVERSHOOT` out of it. At a corner it is pushed out along both
 * axes, and along a side only perpendicular to it, with a smooth change between
 * the two so a spot sliding past a side's middle does not jump.
 */
export function spotCenter(u: number, width: number, height: number): Point {
  const on = edgePoint(u, width, height)
  const push = (offset: number, half: number): number =>
    Math.min(1, Math.max(-1, (offset / half) * 3))
  return {
    x: on.x + OVERSHOOT * push(on.x - width / 2, width / 2),
    y: on.y + OVERSHOOT * push(on.y - height / 2, height / 2),
  }
}

/** The corner values, for readability. */
const TOP_RIGHT = 1
const BOTTOM_LEFT = 3

/** Where the splash screen's spots sit. */
export const SPLASH_POSE: Pose = {
  spots: [
    { u: TOP_RIGHT, radius: 470, strength: 1 },
    { u: BOTTOM_LEFT, radius: 360, strength: 1 },
  ],
  accent: { u: 2, radius: 300, strength: 0 },
}

/**
 * The conclusion. The spots stay by the corners the steps use and grow, so the
 * field opens up without travelling.
 */
export const ENDING_POSE: Pose = {
  spots: [
    { u: TOP_RIGHT, radius: 580, strength: 1 },
    { u: BOTTOM_LEFT, radius: 480, strength: 1 },
  ],
  accent: { u: 2, radius: 400, strength: 0 },
}

/** A small deterministic generator, so a step always gets the same pose. */
function seeded(seed: number): () => number {
  let state = (seed * 2654435761) >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let mixed = state
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1)
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61)
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296
  }
}

/** How far a spot sways to either side of its corner, in edge units. */
const SWAY = 0.07
/** How far from its place a spot may settle, in edge units each way. */
const SETTLE_JITTER = 0.04
/** How much a spot's radius swells and shrinks from step to step. */
const BREATH = 0.14

/**
 * The pose of the story's step `step`, counting from 0. Each spot stays by its
 * own corner and sways a little, swelling and shrinking as it goes, so the
 * field breathes between screens instead of travelling. The pose depends on the
 * step and nothing else, so going back to a step reproduces it and the story's
 * length never shows.
 */
export function stepPose(step: number, moment: boolean): Pose {
  const random = seeded(step + 1)
  const sway = step % 2 === 0 ? -SWAY : SWAY
  // Size does most of the moving: a spot swells as it sways one way and
  // shrinks as it sways back.
  const breath = 1 + (step % 2 === 0 ? -BREATH : BREATH)
  const near = (): number => sway + (random() - 0.5) * SETTLE_JITTER
  const first: SpotPose = {
    u: wrapEdge(TOP_RIGHT + near()),
    radius: (430 + random() * 90) * breath,
    strength: 1,
  }
  const second: SpotPose = {
    u: wrapEdge(BOTTOM_LEFT + near()),
    radius: (330 + random() * 90) * breath,
    strength: 1,
  }
  const accent: SpotPose = {
    u: wrapEdge(TOP_RIGHT + 1 + near()),
    radius: (360 + random() * 80) * breath,
    strength: moment ? 1 : 0,
  }
  return { spots: [first, second], accent }
}

/**
 * `pose` shifted so each spot reaches its target the short way round the loop
 * from `from`. The result's `u` may lie outside 0..4 and is only for
 * interpolating, so apply it through `wrapEdge`.
 */
export function reachable(from: Pose, to: Pose): Pose {
  const way = (a: SpotPose, b: SpotPose): SpotPose => ({
    ...b,
    u: a.u + loopDelta(a.u, b.u),
  })
  return {
    spots: [way(from.spots[0], to.spots[0]), way(from.spots[1], to.spots[1])],
    accent: way(from.accent, to.accent),
  }
}

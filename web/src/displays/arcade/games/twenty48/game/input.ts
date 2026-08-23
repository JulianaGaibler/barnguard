/**
 * Turning touches into directions.
 *
 * Two affordances, both of which must work for one player or for two at once: a
 * swipe anywhere over a board, and the four arrow bars around it. Neither needs
 * to know how many players there are, because both disambiguate purely by
 * position: each board binds its own gesture over its own plate, and each bar
 * is a node with its own hit rect.
 */
import { bindRegionGesture, type Engine } from '@src/stargazer'
import { containsWorld, type BoardGeom } from './layout'
import { GESTURE } from './tuning'
import type { Direction } from './types'

/** A point in world space. */
export interface Pt {
  x: number
  y: number
}

/**
 * The direction of a drag, or `null` when it did not travel far enough to be a
 * swipe. The larger of the two axes wins; a perfect diagonal resolves
 * horizontally, which only matters for a pixel-exact 45 degrees.
 */
export function classifySwipe(
  from: Pt,
  to: Pt,
  opts: { minDistance: number },
): Direction | null {
  const dx = to.x - from.x
  const dy = to.y - from.y
  const ax = Math.abs(dx)
  const ay = Math.abs(dy)
  if (Math.max(ax, ay) < opts.minDistance) return null
  if (ax >= ay) return dx > 0 ? 'right' : 'left'
  return dy > 0 ? 'down' : 'up'
}

/** What a board hands the gesture binding. */
export interface SwipeTarget {
  /** Live geometry, re-read each press so a resize needs no rebind. */
  geom: () => BoardGeom
  /** Whether this board is accepting input right now. */
  enabled: () => boolean
  onSwipe: (dir: Direction) => void
  /** A press that landed outside every board. Wired to the pause menu. */
  onReject?: () => void
}

/**
 * Bind swipe handling for one board. Returns an unbind.
 *
 * Each board gets its own single-pointer region, so two players never contend
 * for one tracker and a finger that starts on one plate cannot steal the other
 * player's move by sliding across. The direction is settled on release rather
 * than the moment the drag crosses the threshold, so one gesture is always
 * exactly one move.
 */
export function bindBoardSwipe(
  engine: Engine,
  target: SwipeTarget,
): () => void {
  let start: Pt | null = null
  return bindRegionGesture(engine, {
    singlePointer: true,
    hitTest: (w) => containsWorld(target.geom(), w.x, w.y),
    enabled: target.enabled,
    down: (e) => {
      start = { x: e.pointer.world.x, y: e.pointer.world.y }
    },
    up: (e) => {
      const from = start
      start = null
      if (!from) return
      const dir = classifySwipe(
        from,
        { x: e.pointer.world.x, y: e.pointer.world.y },
        {
          minDistance: target.geom().cell * GESTURE.minDistanceFrac,
        },
      )
      if (dir) target.onSwipe(dir)
    },
    cancel: () => {
      start = null
    },
    onReject: () => target.onReject?.(),
  })
}

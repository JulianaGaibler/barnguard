import type { Vec2 } from '../math/Vec2'
import type { Engine } from '../engine/Engine'
import type { PointerEvent2D } from './PointerState'

/**
 * Options for {@link bindRegionGesture}.
 *
 * @category Input
 */
export interface RegionGestureOptions {
  /**
   * Accept a press only when the pointer's world position passes this test
   * (e.g. inside a board rect). Omit to accept anywhere on the stage. A press
   * that fails goes to {@link onReject} instead of {@link down}.
   */
  hitTest?: (world: Readonly<Vec2>) => boolean
  /**
   * Gate presses on game state (e.g. only during play). A press while this
   * returns `false` goes to {@link onReject}. Omit to always accept.
   */
  enabled?: () => boolean
  /**
   * Track only the first accepted press; ignore other pointers until it
   * releases. Default `true`. Set `false` for a multi-touch region.
   */
  singlePointer?: boolean
  /** Fires on an accepted press (passed `hitTest` and `enabled`). */
  down?: (e: PointerEvent2D) => void
  /** Fires on move for the tracked pointer. */
  move?: (e: PointerEvent2D) => void
  /** Fires on release for the tracked pointer. */
  up?: (e: PointerEvent2D) => void
  /** Fires on cancel for the tracked pointer. */
  cancel?: (e: PointerEvent2D) => void
  /**
   * Fires on a press rejected by `hitTest` or `enabled` — a hook for "tap
   * outside the play area opens the menu"-style affordances. Not called for
   * secondary pointers ignored under `singlePointer`.
   */
  onReject?: (e: PointerEvent2D) => void
}

/**
 * Bind a single-pointer gesture to a region of the stage, over the engine's
 * primary pointer stream. Wraps the raw
 * `engine.events.on('pointerDown'|'pointerMove'|'pointerUp'|'pointerCancel')`
 * pattern — active-pointer tracking, a hit-region test, and a state gate — that
 * sessions otherwise hand-roll across four handlers. Returns an unsubscribe.
 *
 * ```ts
 * const off = bindRegionGesture(host.engine, {
 *   hitTest: (w) => insideBoard(w.x, w.y),
 *   enabled: () => state === 'playing' && !paused,
 *   down: (e) => beginPreview(e),
 *   move: (e) => movePreview(e),
 *   up: (e) => commitDrop(e),
 *   onReject: () => pause(), // tap outside the board → menu
 * })
 * ```
 *
 * @category Input
 */
export function bindRegionGesture(
  engine: Engine,
  opts: RegionGestureOptions,
): () => void {
  const singlePointer = opts.singlePointer ?? true
  let activeId: number | null = null

  const offDown = engine.events.on('pointerDown', (e) => {
    if (singlePointer && activeId !== null) return
    if (opts.enabled && !opts.enabled()) {
      opts.onReject?.(e)
      return
    }
    if (opts.hitTest && !opts.hitTest(e.pointer.world)) {
      opts.onReject?.(e)
      return
    }
    activeId = e.pointer.id
    opts.down?.(e)
  })

  const tracked = (e: PointerEvent2D): boolean =>
    !singlePointer || e.pointer.id === activeId

  const offMove = engine.events.on('pointerMove', (e) => {
    if (tracked(e)) opts.move?.(e)
  })
  const offUp = engine.events.on('pointerUp', (e) => {
    if (!tracked(e)) return
    if (e.pointer.id === activeId) activeId = null
    opts.up?.(e)
  })
  const offCancel = engine.events.on('pointerCancel', (e) => {
    if (!tracked(e)) return
    if (e.pointer.id === activeId) activeId = null
    opts.cancel?.(e)
  })

  return () => {
    offDown()
    offMove()
    offUp()
    offCancel()
  }
}

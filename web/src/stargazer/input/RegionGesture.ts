import type { Vec2 } from '../math/Vec2'
import type { Engine } from '../engine/Engine'
import type { PointerEvent2D } from './PointerState'

/** Options for {@link bindRegionGesture}. */
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
   * Track only the first accepted press, ignoring other pointers until it
   * releases. Default `true`. Set `false` for a multi-touch region, which then
   * follows every pointer that lands on it.
   */
  singlePointer?: boolean
  /** Fires on an accepted press (passed `hitTest` and `enabled`). */
  down?: (e: PointerEvent2D) => void
  /** Fires on move for a pointer this binding accepted. */
  move?: (e: PointerEvent2D) => void
  /** Fires on release for a pointer this binding accepted. */
  up?: (e: PointerEvent2D) => void
  /** Fires on cancel for a pointer this binding accepted. */
  cancel?: (e: PointerEvent2D) => void
  /**
   * Fires on a press rejected by `hitTest` or `enabled`, a hook for "tap
   * outside the play area opens the menu"-style affordances. Not called for
   * secondary pointers ignored under `singlePointer`.
   */
  onReject?: (e: PointerEvent2D) => void
}

/**
 * Bind a gesture to a region of the stage, over the engine's primary pointer
 * stream. Wraps the raw
 * `engine.events.on('pointerDown'|'pointerMove'|'pointerUp'|'pointerCancel')`
 * pattern (active-pointer tracking, a hit-region test, and a state gate) that
 * sessions otherwise hand-roll across four handlers. Returns an unsubscribe.
 *
 * @example
 *   const off = bindRegionGesture(host.engine, {
 *     hitTest: (w) => insideBoard(w.x, w.y),
 *     enabled: () => state === 'playing' && !paused,
 *     down: (e) => beginPreview(e),
 *     move: (e) => movePreview(e),
 *     up: (e) => commitDrop(e),
 *     onReject: () => pause(), // tap outside the board → menu
 *   })
 */
export function bindRegionGesture(
  engine: Engine,
  opts: RegionGestureOptions,
): () => void {
  const singlePointer = opts.singlePointer ?? true
  /**
   * The pointers this binding accepted on `down`.
   *
   * A set rather than one id, so a multi-touch region can follow every finger
   * it took while still turning away the ones it did not. The pointer stream is
   * the whole stage's: without this, a `singlePointer: false` binding would see
   * `move` and `up` for fingers that landed on another region entirely, having
   * never been offered their `down`.
   */
  const held = new Set<number>()

  const offDown = engine.events.on('pointerDown', (e) => {
    if (singlePointer && held.size > 0) return
    if (opts.enabled && !opts.enabled()) {
      opts.onReject?.(e)
      return
    }
    if (opts.hitTest && !opts.hitTest(e.pointer.world)) {
      opts.onReject?.(e)
      return
    }
    held.add(e.pointer.id)
    opts.down?.(e)
  })

  const offMove = engine.events.on('pointerMove', (e) => {
    if (held.has(e.pointer.id)) opts.move?.(e)
  })
  const offUp = engine.events.on('pointerUp', (e) => {
    if (held.delete(e.pointer.id)) opts.up?.(e)
  })
  const offCancel = engine.events.on('pointerCancel', (e) => {
    if (held.delete(e.pointer.id)) opts.cancel?.(e)
  })

  return () => {
    offDown()
    offMove()
    offUp()
    offCancel()
  }
}

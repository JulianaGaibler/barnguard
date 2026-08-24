/**
 * The gesture layer over the buffer, which sits alongside the buttons rather
 * than replacing them.
 *
 * Buttons are for precision and the buffer is for speed. A tap anywhere on the
 * buffer turns the piece, which gives the most frequent action a target the
 * size of the playfield and costs nothing when it is misjudged: a wrong turn is
 * one more tap away from right.
 *
 * The flick is the only gesture that can end a placement, and it is the only
 * one that tests speed as well as distance. Hard drop has no way back, so it
 * has to be something the hand does on purpose.
 *
 * This module is the adapter. {@link GestureRecognizer} holds every rule about
 * what a gesture is, with no engine underneath it, so the rules can be tested
 * against exact coordinates and timings.
 */
import { bindRegionGesture, type Engine } from '@src/stargazer'
import { GestureRecognizer, type GestureIntent } from './gestures'
import { insideBuffer, type SeatGeometry } from './layout'
import type { Action } from './types'

export interface BufferGestureTarget {
  /** Read fresh each event, so a resize needs no rebind. */
  geom: () => SeatGeometry
  enabled: () => boolean
  onAction: (action: Action) => void
  /** Hold the piece falling fast, for as long as the finger stays low. */
  onSoftDrop: (held: boolean) => void
  /** Anchor the piece where it stands, before the first drag step. */
  onDragStart: () => void
  /** Slide the piece this many columns from where the drag began. */
  onDragBy: (columns: number) => void
  onDragEnd: () => void
  /** Defaults to the page clock. Injected so tests can drive speed exactly. */
  now?: () => number
}

export function bindBufferGestures(
  engine: Engine,
  target: BufferGestureTarget,
): () => void {
  const now = target.now ?? ((): number => performance.now())

  const apply = (intent: GestureIntent): void => {
    switch (intent.kind) {
      case 'rotate':
        target.onAction(intent.direction === 'cw' ? 'rotateCW' : 'rotateCCW')
        break
      case 'hardDrop':
        target.onAction('hardDrop')
        break
      case 'softDrop':
        target.onSoftDrop(intent.held)
        break
      case 'dragStart':
        target.onDragStart()
        break
      case 'dragBy':
        target.onDragBy(intent.columns)
        break
      case 'dragEnd':
        target.onDragEnd()
        break
    }
  }

  const gestures = new GestureRecognizer({
    cell: () => target.geom().cell,
    emit: apply,
  })

  /**
   * Drop everything when the game stops accepting input.
   *
   * A pause can arrive mid-gesture, and the buttons are hidden behind the menu
   * while a finger is still on the buffer. Without this the piece stays soft
   * dropping under the pause screen.
   */
  const gateClosed = (): boolean => {
    if (target.enabled()) return false
    if (gestures.active) gestures.reset()
    return true
  }

  return bindRegionGesture(engine, {
    // Both fingers of a pair have to reach the recogniser. The binding follows
    // only the pointers that landed on this buffer, so in a race the other
    // seat's fingers never arrive here.
    singlePointer: false,
    hitTest: (w) => insideBuffer(target.geom(), w.x, w.y),
    enabled: target.enabled,
    // No `onReject`. It fires for every press that misses this region, which
    // includes every control button and, in a race, the other player's whole
    // half, so hanging anything on it here would fire constantly.
    down: (e) =>
      gestures.down(e.pointer.id, e.pointer.world.x, e.pointer.world.y, now()),
    move: (e) => {
      if (gateClosed()) return
      gestures.move(e.pointer.id, e.pointer.world.x, e.pointer.world.y, now())
    },
    up: (e) => {
      if (gateClosed()) return
      gestures.up(e.pointer.id, now())
    },
    cancel: (e) => gestures.cancel(e.pointer.id),
  })
}

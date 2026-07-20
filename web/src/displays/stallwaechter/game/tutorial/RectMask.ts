import type { Rect } from '@src/stargazer'
import type { PacketMask } from '../behaviors/PacketBehavior'

/**
 * Rectangular AABB stand-in for `BitmapMask` used by the tutorial mini-stage. A
 * point is "inside" the mask when it sits inside `rect` shrunk by `inset` on
 * every side, matching `BitmapMask.contains(pt, inset)` semantics:
 *
 * - `contains(x, y, 0)`, true iff `(x, y)` is inside the full rect.
 *   `PacketBehavior::onFixedStep` uses this as the exit gate; when it flips to
 *   false the packet fires `onExitedGermany`.
 * - `contains(x, y, 8)`, true iff `(x, y)` is at least 8 world units inside every
 *   edge. `PacketBehavior::applyBorderTurnaround` uses this to short-circuit
 *   turnaround when the packet is already past the safe zone. Returning false
 *   near the edge lets the tutorial packet fly off the viewport rather than
 *   bouncing back inside.
 */
export class RectMask implements PacketMask {
  #rect: Rect

  constructor(rect: Rect) {
    this.#rect = { ...rect }
  }

  /**
   * Replace the mask rect in place. Callers hold the same `RectMask` instance
   * across canvas resizes so downstream references (e.g.
   * `PacketSessionHooks.mask`) don't have to be re-wired every time the
   * viewport reshapes.
   */
  setRect(rect: Rect): void {
    this.#rect = { ...rect }
  }

  contains(x: number, y: number, inset: number): boolean {
    const r = this.#rect
    return (
      x >= r.x + inset &&
      x <= r.x + r.width - inset &&
      y >= r.y + inset &&
      y <= r.y + r.height - inset
    )
  }
}

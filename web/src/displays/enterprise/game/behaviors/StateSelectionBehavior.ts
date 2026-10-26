import { PointerBehavior, type PointerHandlers } from 'stargazer'
import type { RegionId } from '../maps/types'

/**
 * Callback the behavior fires when a state is tapped. Session-scoped.
 * `GameSession` provides the emit closure and enforces `session.state ===
 * 'idle'` gating so mid-zoom taps are dropped.
 */
export type OnStateTap = (id: RegionId) => void

/**
 * Finds the region whose disc covers a world point, if any. A disc sits over
 * its neighbours' fills, so a tap on one has to win over the fill under it.
 */
export type DiscAt = (x: number, y: number) => RegionId | null

/**
 * Attached to every state's `Path2DNode` (hitMode: 'fill'). Forwards a tap to
 * the session. The session decides whether to act on it. Hover feedback (mouse
 * only) is left to the caller because it wants to know about the
 * currently-selected state and animate accordingly.
 */
export class StateSelectionBehavior extends PointerBehavior {
  readonly #stateId: RegionId
  readonly #onTap: OnStateTap
  readonly #discAt: DiscAt | undefined

  constructor(stateId: RegionId, onTap: OnStateTap, discAt?: DiscAt) {
    super()
    this.#stateId = stateId
    this.#onTap = onTap
    this.#discAt = discAt
  }

  protected handlers(): PointerHandlers {
    // Bind on the node so the InputSystem routes captures here. The node's
    // `hitMode: 'fill'` is set by the Path2DNode constructor.
    return {
      down: (e) => {
        // Only fire on the captured node, synthetic events (camera-drift)
        // still carry `capturedBy`, and we only want the initial tap.
        if (e.pointer.capturedBy !== this.node) return
        const disc = this.#discAt?.(e.pointer.world.x, e.pointer.world.y)
        this.#onTap(disc ?? this.#stateId)
      },
      // The Path2DNode sets its own hit-testing (via hitMode), don't
      // override the hitEnabled flag it set.
      hitEnabled: false,
    }
  }
}

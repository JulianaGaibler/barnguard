import { Behaviour, type PointerEvent2D } from '@src/stargazer'
import type { StateId } from '../data/states'

/**
 * Callback the behaviour fires when a state is tapped. Session-scoped. *
 * `GameSession` provides the emit closure and enforces `session.state ===
 * 'idle'` gating so mid-zoom taps are dropped.
 */
export type OnStateTap = (id: StateId) => void

/**
 * Attached to every state's `Path2DNode` (hitMode: 'fill'). Forwards a tap to
 * the session; the session decides whether to act on it. Hover feedback (mouse
 * only) is left to the caller because it wants to know about the
 * currently-selected state and animate accordingly.
 */
export class StateSelectionBehaviour extends Behaviour {
  private readonly stateId: StateId
  private readonly onTap: OnStateTap

  constructor(stateId: StateId, onTap: OnStateTap) {
    super()
    this.stateId = stateId
    this.onTap = onTap
  }

  private unbindPointer: (() => void) | null = null

  override onAttach(): void {
    // Bind on the node so the InputSystem routes captures here. The node's
    // `hitMode: 'fill'` is set by the Path2DNode constructor.
    this.unbindPointer = this.node.bindPointer({
      down: (e: PointerEvent2D): void => {
        // Only fire on the captured node, synthetic events (camera-drift)
        // still carry `capturedBy`, and we only want the initial tap.
        if (e.pointer.capturedBy !== this.node) return
        this.onTap(this.stateId)
      },
      // The Path2DNode sets its own hit-testing (via hitMode); don't
      // override the hitEnabled flag it set.
      hitEnabled: false,
    })
  }

  override onDetach(): void {
    this.unbindPointer?.()
    this.unbindPointer = null
  }
}

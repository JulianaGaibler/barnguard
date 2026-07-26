import { Behavior } from './Behavior'
import type { PointerHandlers } from './Node2D'

/**
 * A {@link Behavior} that binds pointer handlers to its node for its whole
 * attached lifetime. Subclasses return the handlers from {@link handlers}; the
 * base wires them via {@link Node2D.bindPointer} on attach and unbinds on detach
 * (including a synthetic cancel if a capture is live), so the bind/unbind
 * bookkeeping stops being copied into every input behavior.
 *
 * @category Scene
 * @example
 *   class DragToMove extends PointerBehavior {
 *     protected handlers(): PointerHandlers {
 *       return {
 *         singlePointer: true,
 *         move: (e) => {
 *           const p = e.localTo(this.node)
 *           this.node.transform.x = p.x
 *           this.node.transform.y = p.y
 *         },
 *       }
 *     }
 *   }
 *   node.addBehavior(new DragToMove())
 */
export abstract class PointerBehavior extends Behavior {
  #unbind: (() => void) | null = null

  /** Return the pointer handlers to bind. Called once, on attach. */
  protected abstract handlers(): PointerHandlers

  override onAttach(): void {
    this.#unbind = this.node.bindPointer(this.handlers())
  }

  override onDetach(): void {
    this.#unbind?.()
    this.#unbind = null
    this.onPointerDetach?.()
  }

  /** Optional subclass cleanup, runs after the handlers are unbound. */
  protected onPointerDetach?(): void
}

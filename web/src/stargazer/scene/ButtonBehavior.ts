import { PointerBehavior } from './PointerBehavior'
import type { PointerEvent2D } from '../input/PointerState'
import type { PointerHandlers } from './Node2D'

/** How a node behaves as a tap button. */
export interface ButtonOptions {
  onClick: () => void
  /** The button is inert (no press, no click) while this is (or returns) false. */
  enabled?: boolean | (() => boolean)
  /** Track only the first pressed pointer. Default true. */
  singlePointer?: boolean
  /** Called when the pressed state flips, so the node can redraw itself. */
  onPressedChange?: (pressed: boolean) => void
}

/**
 * Turns its node into a tap button. Attach with `node.addBehavior(...)`; the
 * node draws itself and reads the pressed state from `onPressedChange`.
 *
 * The node is pressed on `down` and `onClick` fires on `up` only if the release
 * still hits the node, so a press dragged off before release is cancelled.
 *
 * @example
 *   node.addBehavior(
 *     new ButtonBehavior({
 *       onClick: () => toggle(),
 *       onPressedChange: (p) => (this.pressed = p),
 *     }),
 *   )
 */
export class ButtonBehavior extends PointerBehavior {
  readonly #opts: ButtonOptions
  #pressed = false

  constructor(opts: ButtonOptions) {
    super()
    this.#opts = opts
  }

  /** Whether the button is currently held down. */
  get pressed(): boolean {
    return this.#pressed
  }

  protected handlers(): PointerHandlers {
    return {
      singlePointer: this.#opts.singlePointer ?? true,
      down: () => {
        if (this.#isEnabled()) this.#setPressed(true)
      },
      up: (e) => {
        const was = this.#pressed
        this.#setPressed(false)
        if (was && this.#isEnabled() && this.#hits(e)) this.#opts.onClick()
      },
      cancel: () => this.#setPressed(false),
    }
  }

  #isEnabled(): boolean {
    const e = this.#opts.enabled
    return e === undefined ? true : typeof e === 'function' ? e() : e
  }

  #hits(e: PointerEvent2D): boolean {
    return this.node.hitTest(e.pointer.world.x, e.pointer.world.y, 0)
  }

  #setPressed(pressed: boolean): void {
    if (pressed === this.#pressed) return
    this.#pressed = pressed
    this.#opts.onPressedChange?.(pressed)
  }
}

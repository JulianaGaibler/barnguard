import { PointerBehavior } from './PointerBehavior'
import type { PointerHandlers } from './Node2D'

/** How a node behaves as a press-and-hold button. */
export interface HoldButtonOptions {
  /** Fires on the pressed edge, then once per auto-repeat. */
  onPress: () => void
  /**
   * Auto-repeat while held. Omit for a one-shot button. `delay` is the wait
   * after the initial press before repeating starts, `interval` the period
   * after that. Both in seconds, quantised to the fixed step.
   */
  repeat?: { delay: number; interval: number }
  /**
   * Consulted on press and on every fixed step. Going false mid-hold releases
   * the hold, so a button disabled while a finger rests on it stops repeating
   * immediately instead of resuming where it left off.
   */
  enabled?: boolean | (() => boolean)
  /** Track only the first pressed pointer. Default true. */
  singlePointer?: boolean
  /** Called when the pressed state flips, so the node can redraw itself. */
  onPressedChange?: (pressed: boolean) => void
}

/**
 * Turns its node into a button that acts on the press and can repeat while
 * held. Attach with `node.addBehavior(...)`. The node draws itself and reads
 * the pressed state from `onPressedChange`.
 *
 * The counterpart to {@link ButtonBehavior}, which fires on release. Use this
 * one when the action should land the instant the finger touches down (a game
 * control), and `ButtonBehavior` when the press should be cancellable by
 * sliding off before release (a menu item).
 *
 * @remarks
 *   The repeat runs on the fixed step rather than the render frame, so its rate
 *   is the same on a 60 Hz and a 144 Hz display. The fixed step is also
 *   pause-gated, which freezes a repeat mid-hold. Pointer handlers are not, so
 *   a finger held across a pause would otherwise resume mid-repeat and fire the
 *   instant the engine unpauses. Passing `enabled` an expression that is false
 *   while paused is what prevents that.
 *
 *   Once held, the repeat continues even if the finger drifts off the node,
 *   because the pointer stays captured. On glass a fingertip moving a
 *   millimetre should not drop the input.
 * @example
 *   // Hold to shift a piece sideways: once, then every 50ms after 170ms.
 *   node.addBehavior(
 *     new HoldButtonBehavior({
 *       onPress: () => move(-1),
 *       repeat: { delay: 0.17, interval: 0.05 },
 *       enabled: () => state === 'playing',
 *     }),
 *   )
 */
export class HoldButtonBehavior extends PointerBehavior {
  readonly #opts: HoldButtonOptions
  #pressed = false
  /** Seconds accumulated since the last fired press. Only read while held. */
  #elapsed = 0
  #repeating = false

  constructor(opts: HoldButtonOptions) {
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
        if (!this.#isEnabled()) return
        this.#setPressed(true)
        this.#opts.onPress()
      },
      up: () => this.#setPressed(false),
      cancel: () => this.#setPressed(false),
    }
  }

  override onFixedStep(fixedDt: number): void {
    if (!this.#pressed) return
    if (!this.#isEnabled()) {
      this.#setPressed(false)
      return
    }
    const repeat = this.#opts.repeat
    if (!repeat) return

    this.#elapsed += fixedDt
    // A loop rather than a single test: an interval shorter than the fixed step
    // still has to fire more than once per step to hold its rate. The period is
    // read each pass, because the first fire is what switches it from the
    // initial delay to the repeat interval.
    for (;;) {
      const period = this.#repeating ? repeat.interval : repeat.delay
      // A non-positive interval would never drain the accumulator. A delay of
      // zero is legitimate and means the repeat starts on the first step.
      if (this.#repeating && period <= 0) break
      if (this.#elapsed < period) break
      this.#elapsed -= period
      this.#repeating = true
      this.#opts.onPress()
    }
  }

  protected override onPointerDetach(): void {
    // The base class synthesizes a cancel for a live capture, but a node torn
    // down between frames may never see one. Clearing here keeps a reused
    // behavior from carrying a stale repeat clock into its next press.
    this.#pressed = false
    this.#elapsed = 0
    this.#repeating = false
  }

  #isEnabled(): boolean {
    const e = this.#opts.enabled
    return e === undefined ? true : typeof e === 'function' ? e() : e
  }

  #setPressed(pressed: boolean): void {
    if (pressed === this.#pressed) return
    this.#pressed = pressed
    this.#elapsed = 0
    this.#repeating = false
    this.#opts.onPressedChange?.(pressed)
  }
}

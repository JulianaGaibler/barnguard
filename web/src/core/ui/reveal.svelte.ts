/**
 * A staggered entrance and exit for a screen's parts, driven by the engine's
 * animator so it runs on the engine clock and pauses with it.
 *
 * Each part has a progress `v` from 0 (hidden) to 1 (shown). The screen binds
 * its own opacity and offset to those numbers, so the motion belongs to the
 * animator and the markup only reads the result.
 */
import { untrack } from 'svelte'
import { AbortScope, easings, ignoreAbort, type Engine } from 'stargazer'

/** Seconds between one part starting and the next. */
const STAGGER_SEC = 0.12
const SHOW_SEC = 0.55
const HIDE_SEC = 0.25

export class Reveal {
  /** One progress value per part, in the order the parts appear. */
  readonly items = $state<{ v: number }[]>([])

  readonly #engine: Engine
  readonly #scope = new AbortScope()

  constructor(engine: Engine, parts: number) {
    this.#engine = engine
    for (let i = 0; i < parts; i++) this.items.push({ v: 0 })
  }

  /** Whether any part is showing, so a hidden screen can leave hit-testing. */
  get visible(): boolean {
    return this.items.some((item) => item.v > 0.001)
  }

  /**
   * Bring the parts in one after another. Safe to call from an effect: starting
   * a tween reads the part's current value, which the effect would otherwise
   * track, and every tick of the tween would then restart it.
   */
  show(): void {
    const signal = this.#scope.reset()
    untrack(() => {
      this.items.forEach((item, i) => {
        this.#engine
          .tween(
            item,
            { v: 1 },
            {
              duration: SHOW_SEC,
              delay: i * STAGGER_SEC,
              easing: easings.outCubic,
              signal,
            },
          )
          .catch(ignoreAbort)
      })
    })
  }

  /** Take every part out together. Resolves once they are gone. */
  async hide(): Promise<void> {
    const signal = this.#scope.reset()
    const tweens = untrack(() =>
      this.items.map((item) =>
        this.#engine.tween(
          item,
          { v: 0 },
          { duration: HIDE_SEC, easing: easings.inCubic, signal },
        ),
      ),
    )
    await Promise.all(tweens).catch(ignoreAbort)
  }

  destroy(): void {
    this.#scope.dispose()
  }
}

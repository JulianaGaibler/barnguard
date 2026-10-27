import { ignoreAbort, type Engine } from 'stargazer'
import { Reveal } from '@src/core/ui/reveal.svelte'

/**
 * A staggered entrance for `count` parts of a screen, on the engine's clock. It
 * waits `delay` seconds first, so the parts come in after the screen has, and
 * `v(i)` is how far part `i` is in, from 0 to 1.
 */
export class Entrance {
  readonly #reveal: Reveal
  readonly #abort = new AbortController()

  constructor(
    engine: Pick<Engine, 'tween' | 'wait'>,
    count: number,
    delay = 0.3,
  ) {
    this.#reveal = new Reveal(engine as Engine, count)
    engine
      .wait(delay, this.#abort.signal)
      .then(() => this.#reveal.show())
      .catch(ignoreAbort)
  }

  /** How far part `i` is in. */
  v(i: number): number {
    return this.#reveal.items[i]?.v ?? 0
  }

  destroy(): void {
    this.#abort.abort()
    this.#reveal.destroy()
  }
}

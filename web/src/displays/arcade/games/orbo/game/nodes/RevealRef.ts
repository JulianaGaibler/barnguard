import type { Versioned } from '@src/stargazer'

/**
 * The shared reveal fraction of the play field (0 = hidden, 1 = fully open).
 * Nodes that paint from it call `canvas.use(reveal)`, and any write to `frac`,
 * including a tween's, bumps `version` so they paint again.
 */
export class RevealRef implements Versioned {
  version = 0
  #frac: number

  constructor(frac: number) {
    this.#frac = frac
  }

  get frac(): number {
    return this.#frac
  }

  set frac(value: number) {
    if (Object.is(value, this.#frac)) return
    this.#frac = value
    this.version++
  }
}

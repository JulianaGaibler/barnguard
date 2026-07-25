import { abortError } from './abortSignal'

/**
 * One step in a {@link Timeline}: a function returning a Promise that resolves
 * when the step is done. It receives the signal passed to {@link Timeline.run}
 * (if any), so a step can scope its own tween/wait to it — `(s) =>
 * node.tween(to, { duration, signal: s })` — without closing over an outer
 * variable. Ignore the argument for steps that are already node-scoped.
 *
 * @category Animation
 */
export type TimelineStep = (signal?: AbortSignal) => Promise<void>

/**
 * Fluent builder for a sequence of async steps. Each `add(step)` runs after the
 * previous one resolves; `parallel(...steps)` runs a batch concurrently within
 * a single sequenced position.
 *
 * `run(signal)` checks the signal between steps and forwards it into each step.
 * Pair it with an {@link AbortScope}: `timeline.run(scope.signal)` cancels the
 * whole sequence when the scope's epoch ends — steps that thread the signal
 * into their tweens abort mid-step, and the between-steps check stops the rest.
 * Node-scoped steps (`node.tween(...)`) already abort on node destroy
 * regardless.
 *
 * Steps must return the tween/wait Promise, so use `node.tween` /
 * `node.tweenTo` (not the fire-and-forget `node.play` / `node.playTo`, which
 * return `void`). A step's tween may still carry a `key` for a self-cancelling
 * restart.
 *
 * @category Animation
 * @example
 *   await node
 *     .timeline()
 *     .add((s) => node.tween({ y: 100 }, { duration: 0.3, signal: s }))
 *     .parallel(
 *       (s) =>
 *         node.tween({ scaleX: 2, scaleY: 2 }, { duration: 0.2, signal: s }),
 *       (s) => node.tween({ alpha: 0 }, { duration: 0.2, signal: s }),
 *     )
 *     .run(scope.signal)
 */
export class Timeline {
  readonly #steps: TimelineStep[] = []

  add(step: TimelineStep): this {
    this.#steps.push(step)
    return this
  }

  parallel(...steps: TimelineStep[]): this {
    if (steps.length === 0) return this
    this.#steps.push(async (signal) => {
      await Promise.all(steps.map((s) => s(signal)))
    })
    return this
  }

  async run(signal?: AbortSignal): Promise<void> {
    for (const step of this.#steps) {
      if (signal?.aborted) throw abortError()
      await step(signal)
    }
  }
}

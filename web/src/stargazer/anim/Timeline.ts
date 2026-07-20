import { abortError } from './abortSignal'

/**
 * One step in a {@link Timeline}: a function that returns a Promise resolving
 * when the step is done.
 *
 * @category Animation
 */
export type TimelineStep = () => Promise<void>

/**
 * Fluent builder for a sequence of async steps. Each `add(step)` runs after the
 * previous one resolves; `parallel(...steps)` runs a batch concurrently within
 * a single sequenced position.
 *
 * Timeline itself doesn't attach abort listeners to inner steps, the steps are
 * expected to already be scoped (via `SceneNode.tween`, or by capturing an
 * outer signal in their closures). `run(signal)` checks the outer signal
 * between steps; when it aborts mid-step, the inner tween's own signal scope is
 * what actually cancels the running work.
 *
 * @category Animation
 * @example
 *   await node
 *     .timeline()
 *     .add(() => node.tween({ y: 100 }, { duration: 0.3 }))
 *     .parallel(
 *       () => node.tween({ scaleX: 2, scaleY: 2 }, { duration: 0.2 }),
 *       () => node.tween({ alpha: 0 }, { duration: 0.2 }),
 *     )
 *     .run(node.abortSignal)
 */
export class Timeline {
  readonly #steps: TimelineStep[] = []

  add(step: TimelineStep): this {
    this.#steps.push(step)
    return this
  }

  parallel(...steps: TimelineStep[]): this {
    if (steps.length === 0) return this
    this.#steps.push(async () => {
      await Promise.all(steps.map((s) => s()))
    })
    return this
  }

  async run(signal?: AbortSignal): Promise<void> {
    for (const step of this.#steps) {
      if (signal?.aborted) throw abortError()
      await step()
    }
  }
}

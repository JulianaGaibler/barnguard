import { abortError } from './abortSignal'

export type TimelineStep = () => Promise<void>

/**
 * Fluent builder for a sequence of async steps. Each `add(step)` runs after the
 * previous one resolves; `parallel(...steps)` runs a batch concurrently within
 * a single sequenced position.
 *
 * Timeline itself doesn't attach abort listeners to inner steps, the steps are
 * expected to already be scoped (via `node.tween`, or by capturing an outer
 * signal in their closures). `run(signal)` checks the outer signal between
 * steps; when it aborts mid-step, the inner tween's own signal scope is what
 * actually cancels the running work.
 */
export class Timeline {
  private readonly steps: TimelineStep[] = []

  add(step: TimelineStep): this {
    this.steps.push(step)
    return this
  }

  parallel(...steps: TimelineStep[]): this {
    if (steps.length === 0) return this
    this.steps.push(async () => {
      await Promise.all(steps.map((s) => s()))
    })
    return this
  }

  async run(signal?: AbortSignal): Promise<void> {
    for (const step of this.steps) {
      if (signal?.aborted) throw abortError()
      await step()
    }
  }
}

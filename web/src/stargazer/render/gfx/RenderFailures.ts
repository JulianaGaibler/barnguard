/** One GPU resource that could not be built. */
export interface RenderFailure {
  /** What failed to build, such as a program or a renderer. */
  source: string
  /** The error message. */
  message: string
}

/**
 * Collects the GPU resources a stage could not build, so a broken shader does
 * not fail silently.
 *
 * @remarks
 *   For engine developers: pipelines compile asynchronously and a compile error
 *   surfaces as a rejected promise. The owner of the pipelines catches it,
 *   reports it here and keeps going, so draws that do not need the failed
 *   pipeline still render. The same source and message are stored and logged
 *   once.
 */
export class RenderFailures {
  readonly #list: RenderFailure[] = []
  readonly #listeners = new Set<(failure: RenderFailure) => void>()

  /** Every distinct failure so far, oldest first. */
  get list(): readonly RenderFailure[] {
    return this.#list
  }

  /** Call `listener` for each new failure. Returns an unsubscribe function. */
  onReport(listener: (failure: RenderFailure) => void): () => void {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  /** Record a failure of `source`. A repeat of a known failure is ignored. */
  report(source: string, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    if (this.#list.some((f) => f.source === source && f.message === message)) {
      return
    }
    const failure = { source, message }
    this.#list.push(failure)
    console.error(`Stargazer: ${source} failed to build: ${message}`)
    for (const listener of this.#listeners) listener(failure)
  }
}

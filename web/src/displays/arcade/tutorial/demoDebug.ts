/**
 * Tracing for the tutorial's demo stage, behind `?debug=demo`.
 *
 * A card that shows nothing is the hardest failure in the arcade to reason
 * about, because a still card and a dead card look identical and the whole
 * pipeline is silent: the modal asks for a build, the stage may defer it, the
 * builder lays out against a camera the canvas has not sized yet, and the
 * animation loop runs on a stage that may not be rendering. Any one of those
 * stopping produces the same blank rectangle.
 *
 * So each of those hand-offs logs, once, with the numbers that decide it. The
 * point is to tell "never asked" from "asked and deferred" from "built and not
 * drawing" from "drawing in the wrong place", which is otherwise guesswork.
 *
 * Off unless asked for, and the flag is read once so nothing costs anything in
 * the normal case.
 *
 * @example
 *   // http://localhost:5173/?display=arcade&debug=demo
 *   demoLog('build', { viewport, rect, cell })
 */

/** Whether `?debug=` names the demo tracer. */
function readFlag(): boolean {
  if (typeof window === 'undefined') return false
  const debug = new URLSearchParams(window.location.search).get('debug')
  return debug !== null && debug.split(',').includes('demo')
}

export const DEMO_DEBUG = readFlag()

/** Log one hand-off. A no-op unless the tracer is on. */
export function demoLog(tag: string, data?: unknown): void {
  if (!DEMO_DEBUG) return
  if (data === undefined) console.info(`[demo] ${tag}`)
  else console.info(`[demo] ${tag}`, data)
}

/**
 * Log the first `limit` calls under `tag`, then go quiet.
 *
 * For anything on a frame or an animation step, where the useful signal is "did
 * this happen at all, and how many times" rather than a running stream.
 */
const counts = new Map<string, number>()
export function demoLogFirst(tag: string, limit: number, data?: unknown): void {
  if (!DEMO_DEBUG) return
  const seen = (counts.get(tag) ?? 0) + 1
  counts.set(tag, seen)
  if (seen > limit) return
  demoLog(`${tag} #${seen}${seen === limit ? ' (last)' : ''}`, data)
}

/** Forget the counters, so a reopened modal traces its first calls again. */
export function resetDemoLog(): void {
  counts.clear()
}

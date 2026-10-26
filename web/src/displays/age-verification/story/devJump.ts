/**
 * Opening the story at any screen, for checking a screen's layout without
 * playing up to it. The run is a real path, so Back and the progress row behave
 * as they would for a visitor.
 */
import { flagsOf, Run } from './run'
import type { Flag, NodeId, Story } from './types'
import { enumeratePaths } from './validate'

/**
 * A run standing on `node` with at least `flags` set, by the shortest path that
 * gets there. Null when no path does.
 */
export function runAt(
  story: Story,
  node: NodeId,
  flags: readonly Flag[] = [],
): Run | null {
  let best: Run | null = null
  for (const path of enumeratePaths(story)) {
    const at = path.findIndex((step) => step.node === node)
    if (at === -1) continue
    const history = [...path.slice(0, at), { node }]
    const set = flagsOf(story, history)
    if (!flags.every((flag) => set.has(flag))) continue
    if (!best || history.length < best.history.length) {
      best = new Run(story, history)
    }
  }
  return best
}

/**
 * The run the `node` and `flags` URL parameters ask for, as in
 * `?node=final-choice&flags=strict,checks`. Null without `node`.
 */
export function runFromQuery(story: Story, search: string): Run | null {
  const params = new URLSearchParams(search)
  const node = params.get('node')
  if (!node) return null
  const flags = params.get('flags')?.split(',').filter(Boolean) ?? []
  const run = runAt(story, node, flags)
  if (!run) {
    console.warn(
      `[age-verification] no path reaches "${node}" with flags [${flags.join(', ')}]`,
    )
  }
  return run
}

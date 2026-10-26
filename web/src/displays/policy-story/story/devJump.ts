/**
 * Opening the story at any screen, for checking a screen's layout without
 * playing up to it. The run is a real path, so Back and the progress row behave
 * as they would for a visitor.
 */
import { Run } from './run'
import type { Flag, NodeId, Story } from './types'
import { searchStates } from './validate'

/**
 * A run standing on `node` with at least `flags` set, by the shortest path that
 * gets there. Null when no path does.
 */
export function runAt(
  story: Story,
  node: NodeId,
  flags: readonly Flag[] = [],
): Run | null {
  const { found } = searchStates(
    story,
    (id, set) => id === node && flags.every((flag) => set.has(flag)),
  )
  return found ? new Run(story, found) : null
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
      `[policy-story] no path reaches "${node}" with flags [${flags.join(', ')}]`,
    )
  }
  return run
}

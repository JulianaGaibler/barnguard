/**
 * Keeping a visitor's place. The story is too long for one sitting, so the path
 * so far goes to the browser's storage after every screen, and a reload picks
 * it up where it stopped.
 */
import { Run, type Step } from './run'
import type { Story } from './types'

/** Namespaced as the other displays are: `bg.<display>.<what>`. */
export const SAVED_KEY = 'bg.policy-story.run'

/** The part of the browser's storage this file uses, for a test to stand in. */
export interface SavedStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

function browserStorage(): SavedStorage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/** Remembers `run`. A run still at the start or at an ending is forgotten. */
export function saveRun(
  run: Run,
  storage: SavedStorage | null = browserStorage(),
): void {
  try {
    if (run.atStart || run.atEnd) storage?.removeItem(SAVED_KEY)
    else storage?.setItem(SAVED_KEY, JSON.stringify(run.history))
  } catch {
    // Storage that is full or blocked only costs the visitor their place.
  }
}

/** Forgets the saved run. */
export function clearSavedRun(
  storage: SavedStorage | null = browserStorage(),
): void {
  try {
    storage?.removeItem(SAVED_KEY)
  } catch {
    // Nothing to forget.
  }
}

/**
 * The run saved earlier, or null when there is none or it no longer fits the
 * story: every step is replayed from the start, so a path through screens that
 * have since changed is dropped instead of opened.
 */
export function loadRun(
  story: Story,
  storage: SavedStorage | null = browserStorage(),
): Run | null {
  try {
    const raw = storage?.getItem(SAVED_KEY)
    if (!raw) return null
    const steps: unknown = JSON.parse(raw)
    if (!Array.isArray(steps) || steps.length < 2) return null
    let run = new Run(story)
    for (let i = 0; i < steps.length - 1; i++) {
      const step = steps[i] as Step
      if (step.node !== run.currentId) return null
      const next = steps[i + 1] as Step
      run = step.option === undefined ? run.continue() : run.choose(step.option)
      if (run.currentId !== next.node) return null
    }
    const last = steps[steps.length - 1] as Step
    return run.currentId === last.node && !run.atEnd ? run : null
  } catch {
    return null
  }
}

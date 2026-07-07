import { writable } from 'svelte/store'

/** The high-level screen the booth is currently showing. */
export type Screen = 'idle' | 'playing' | 'result'

/**
 * The shared, resettable application state. The (future) game logic hangs off
 * this object; the admin overlay reads and controls it. Keep it serializable so
 * it can be inspected as JSON in the admin panel.
 */
export interface AppState {
  /** Which screen is active. */
  screen: Screen
  /** Placeholder game score; replace once the game is designed. */
  score: number
  /** Number of play sessions since the last reset (rough usage metric). */
  sessions: number
}

/** The pristine state the booth returns to on reset. */
const createInitialState = (): AppState => ({
  screen: 'idle',
  score: 0,
  sessions: 0,
})

/** The single source of truth for runtime app/game state. */
export const appState = writable<AppState>(createInitialState())

/**
 * Move the booth to a given screen, incrementing the session counter when a new
 * game starts.
 *
 * @param {Screen} screen - The screen to switch to.
 */
export const goToScreen = (screen: Screen): void => {
  appState.update((state) => ({
    ...state,
    screen,
    sessions: screen === 'playing' ? state.sessions + 1 : state.sessions,
  }))
}

/** Reset all runtime state back to its initial values. */
export const resetState = (): void => {
  appState.set(createInitialState())
}

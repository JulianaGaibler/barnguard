/**
 * Orbo's UI copy. English-only, kept as a plain object the game's Svelte
 * components import directly — the game is self-contained and doesn't depend on
 * the arcade's `t` locale store.
 */
export const ORBO_STRINGS = {
  title: 'ORBO',
  loading: 'Loading …',
  mode1v1: 'Play 1v1',
  mode2v2: 'Play 2v2',
  returnToLauncher: 'Return to Launcher',
  teamL: 'Team Blue',
  teamR: 'Team Red',
  // Pause menu.
  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit to menu',
} as const

export type OrboStrings = typeof ORBO_STRINGS

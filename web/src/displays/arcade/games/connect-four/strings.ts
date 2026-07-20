/**
 * Connect Four UI copy. English only, imported directly by the game's Svelte
 * components (the game is self-contained and doesn't use the arcade locale
 * store).
 */
export const CF_STRINGS = {
  title: 'CONNECT 4',
  loading: 'Loading …',
  onePlayer: '1 Player',
  twoPlayers: '2 Players',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  back: 'Back',
  returnToLauncher: 'Return to Launcher',
  // Turn indicator.
  player1: 'Player 1',
  player2: 'Player 2',
  yourTurn: 'Your turn',
  thinking: 'Thinking …',
  // Pause menu.
  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit to menu',
} as const

export type CfStrings = typeof CF_STRINGS

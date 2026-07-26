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
  playAgainstAi: 'Play against AI',
  easy: 'Easy',
  medium: 'Medium',
  hard: 'Hard',
  back: 'Back',
  returnToLauncher: 'Return to Launcher',
  howToPlay: 'How to play',
  // Turn indicator.
  player1: 'Player 1',
  player2: 'Player 2',
  yourTurn: 'Your turn',
  thinking: 'Thinking …',
  // In-engine player tabs.
  tab: {
    p1: 'p.1',
    p2: 'p.2',
    yourTurn: 'your turn',
    won: 'won',
  },
  // Pause menu.
  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit to menu',
  // How-to-play cards.
  tutorial: {
    placeTitle: 'Take turns placing discs',
    placeBody:
      'Players alternate dropping a disc into a column. It falls to the lowest empty slot.',
    winTitle: 'Connect four',
    winBody:
      'Line up four of your discs in a row across, up, or diagonally to win the round.',
  },
} as const

export type CfStrings = typeof CF_STRINGS

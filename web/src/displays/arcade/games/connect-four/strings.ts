/**
 * Connect Four UI copy. English only, imported directly by the game's Svelte
 * components. Copy that is about the arcade shell rather than this game
 * (Paused, Resume, How to play, Return to Launcher) comes from
 * `displays/arcade/i18n` instead, so every game says it the same way.
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
  // In-engine player tabs.
  tab: {
    p1: 'p.1',
    p2: 'p.2',
    yourTurn: 'your turn',
    thinking: 'thinking …',
    won: 'won',
  },
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

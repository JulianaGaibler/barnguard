/**
 * Every player-visible string for Office Overtime.
 *
 * Games in the arcade are self-contained and do not read the display locale
 * store, so the copy lives here rather than in `src/i18n`.
 */
export const OO_STRINGS = {
  title: 'Office Overtime',
  loading: 'Setting up the war room...',
  twoPlayers: '2 Players',
  onePlayer: '1 Player',
  playAgainstAi: 'Play against AI',
  easy: 'Intern',
  medium: 'Manager',
  hard: 'Executive',
  back: 'Back',
  howToPlay: 'How to Play',
  returnToLauncher: 'Return to Launcher',
  resume: 'Resume',
  quit: 'Quit to Menu',
  paused: 'Paused',
  playAgain: 'Play Again',
  menu: 'Menu',
  yourOrg: 'Your org',
  opponentOrg: 'Their org',
  thinking: 'Thinking...',
  yourTurn: 'Your turn',
  theirTurn: 'Their turn',
  chooseOne: 'Pick one',
  management: 'Management',
  ic: 'Individual Contributors',
  approvals: 'Approvals',
  budget: 'Budget',
  finalScore: 'Final score',
  winner: 'wins',
  tie: "It's a tie",
  tieBrokenBy: 'won on leftover budget',
  playerOne: 'Player 1',
  playerTwo: 'Player 2',
  computer: 'Computer',
} as const

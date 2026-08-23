/**
 * Every player-visible string for Full Stack.
 *
 * Games in the arcade are self-contained and do not read the display locale
 * store, so the copy lives here rather than in `src/i18n`.
 */
export const FS_STRINGS = {
  title: 'Full Stack',
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
  chooseOne: 'Pick one',
  cancel: 'Cancel',
  close: 'Close',
  replacedByAi: 'Replaced by AI',
  or: 'or',
  whenHired: 'When you hire them',
  whenScored: 'When the game is scored',
  helpHint: 'Tap a card to see what it does',
  approvals: 'Approvals',
  finalScore: 'Final score',
  winner: 'wins',
  tie: "It's a tie",
  tieBrokenBy: 'won on leftover budget',
  playerOne: 'Player 1',
  playerTwo: 'Player 2',
  computer: 'Computer',
  /**
   * The how-to-play carousel, in play order.
   *
   * One idea per card and a body of two sentences: what the rule is, then what
   * it costs you. Seven cards is more than the rest of the arcade runs, which
   * this game earns by having more parts than the rest of the arcade.
   */
  tutorial: {
    hireTitle: 'Build your org',
    hireBody:
      'Hire nine people into a 3x3 grid. Each one goes beside a hire you already have, in any direction.',
    floorsTitle: 'Two floors',
    floorsBody:
      'Every candidate is Management or an Individual Contributor. The elevator shows which shortlist you may hire from.',
    anatomyTitle: 'Reading a card',
    anatomyBody:
      'Left: The price of the card. Right: The are departments they belong to. Center: An elevator means hiring them sends the car across.',
    resourcesTitle: 'Budget and approvals',
    resourcesBody:
      'Budget buys hires. An approval moves the elevator or redeals a shortlist, and every approval you keep is worth a point.',
    onHireTitle: 'Pays on arrival',
    onHireBody:
      'The upper line is what a hire pays you the moment you place it.',
    reviewTitle: 'Scores at the end',
    reviewBody:
      'The lower line is what the card is worth once the game is scored, and it often depends on where you put it.',
    scoreTitle: 'Most points wins',
    scoreBody:
      'Every card scores, and the approvals you kept add a point each. The higher total takes the match.',
  },
} as const

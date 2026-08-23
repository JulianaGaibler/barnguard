/**
 * English copy for JezzBall. Self-contained plain object the components import
 * directly (the game doesn't depend on the arcade locale store).
 */
export const JEZZBALL_STRINGS = {
  title: 'JEZZBALL',
  tagline: 'Wall it off. Claim the space.',
  loading: 'Loading…',
  modeSolo: '1 Player',
  modeVersus: '2 Players',
  howToPlay: 'How to Play',
  openLeaderboard: 'Leaderboard',
  returnToLauncher: 'Return to Launcher',
  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit',
  gameOver: 'Game over',
  waiting: 'waiting for other player',
  /** Big status word shown over a board that has cleared and is waiting. */
  waitHeadline: 'partitioned',
  /** Big status word shown over a board whose player has run out of lives. */
  out: 'out',
  ready: 'Ready',
  go: 'GO',
  tie: "It's a tie!",
  winsSuffix: 'wins!',
  player1: 'Player 1',
  player2: 'Player 2',
  lvl: 'LVL',
  pts: 'PTS',
  /** Caption on the live time-bonus meter. */
  timeBonus: 'TIME BONUS',
  tutorial: {
    buildTitle: 'Build walls',
    buildBody:
      'Place two fingers to raise a wall from between them. Align your fingers horizontally or verticially to control direction.',
    captureTitle: 'Claim the space',
    captureBody:
      'Each wall grows both ways at once until it hits a wall or the edge. When a wall seals off a region with no ball inside, that whole area is captured. Fence off 75% of the arena to clear the stage.',
    destroyTitle: 'Destructive balls',
    destroyBody:
      'If a ball touches a wall while it is still growing, that half shatters and you lose a life. Run out of lives and it is game over.',
    scoreTitle: 'Score points',
    scoreBody:
      'Every cell you claim is a point. Clearing a stage pays bonuses too: for going past 75%, for finishing fast, and for every life you still hold.',
    /** Row labels on the scoring card's tally. */
    scoreRows: {
      cells: 'Cells claimed',
      fill: 'Past 75%',
      time: 'Fast clear',
      lives: 'Lives held',
      total: 'Total',
    },
  },
} as const

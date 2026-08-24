/**
 * Every piece of copy 2048 shows that is about 2048, in one frozen object the
 * components import directly. Copy that is about the arcade shell rather than
 * this game (Paused, Resume, How to play, Return to Launcher) comes from
 * `displays/arcade/i18n` instead, so every game says it the same way.
 */
export const TWENTY48_STRINGS = {
  title: '2048',
  modeSolo: '1 Player',
  modeVersus: '2 Players',

  /** Above the running score on each board. */
  scoreLabel: 'Score',
  /** Above the largest tile reached, next to the score. */
  bestTileLabel: 'Best tile',

  player1: 'Player 1',
  player2: 'Player 2',
  /** Winner banner, after the player name. */
  winsSuffix: 'wins',
  tie: 'Dead heat',

  /** Shown over a board with no legal move left. */
  noMoves: 'No moves',
  /** Shown over a versus board whose player is finished. */
  out: 'Out',

  tutorial: {
    moveTitle: 'Swipe or tap',
    moveBody:
      'Swipe across the board to slide every tile that way. The bars along each side do the same thing with one tap.',
    mergeTitle: 'Equal tiles merge',
    mergeBody:
      'Two tiles of the same number slide together into one worth double, and that number is added to your score.',
    fullTitle: 'Fill up and it ends',
    fullBody:
      'A new tile appears after every move. When nothing can slide and nothing can merge, your run is over.',
    goalTitle: 'Reach 2048',
    goalBody:
      'Keep a big tile in one corner and build toward it. Getting to 2048 is the goal, but you can carry on past it.',
  },
} as const

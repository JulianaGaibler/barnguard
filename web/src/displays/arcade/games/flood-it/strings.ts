/**
 * Flood It's UI copy. English only, kept as a plain object the game's Svelte
 * components and nodes import directly. The game is self-contained and does not
 * depend on the arcade's `t` locale store.
 */
export const FLOOD_IT_STRINGS = {
  title: 'Flood It',

  modeSolo: '1 Player',
  modeRace: '2 Players: Race',
  modeTerritory: '2 Players: Territory',
  boardSize: 'Board size',
  sizeSmall: 'Small',
  sizeMedium: 'Medium',
  sizeLarge: 'Large',
  howToPlay: 'How to Play',
  returnToLauncher: 'Return to Launcher',

  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit to Menu',

  playAgain: 'Play again',
  menu: 'Menu',

  moves: 'MOVES',
  playerOne: 'Player 1',
  playerTwo: 'Player 2',
  yourTurn: 'Your turn',
  waiting: 'Waiting for the other player',

  wonTitle: 'Flooded',
  lostTitle: 'Out of moves',
  wonBody: (used: number, par: number): string =>
    used < par
      ? `${used} moves. Better than the solver's ${par}.`
      : `${used} moves. The solver needed ${par}.`,
  lostBody: (owned: number, total: number): string =>
    `${Math.round((owned / total) * 100)}% of the board claimed.`,

  raceWin: (player: string): string => `${player} wins`,
  raceTie: 'Dead heat',
  raceMoves: (used: number): string => `${used} moves`,
  raceUnfinished: 'Ran out of moves',

  territoryWin: (player: string): string => `${player} takes it`,
  territoryTie: 'Split down the middle',
  territoryCells: (cells: number): string => `${cells} cells`,
  walledIn: 'Walled in, so the rest was already decided.',
  boardFull: 'Every cell claimed.',

  tutorial: {
    floodTitle: 'Flood from the corner',
    floodBody:
      'You own the corner. Pick a color and your whole region turns that color, taking any neighbour that matches with it.',
    glyphTitle: 'Color alternative',
    glyphBody: 'Turn them shapes mode any time to differentiate without color.',
    limitTitle: 'Mind the counter',
    limitBody:
      'The whole board has to be one color before the moves run out. Bigger boards give you more moves, and less room to waste one.',
  },
} as const

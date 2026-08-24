/**
 * Flood It's UI copy. English only, kept as a plain object the game's Svelte
 * components and nodes import directly. Copy that is about the arcade shell
 * rather than this game (Paused, Resume, How to play, Return to Launcher) comes
 * from `displays/arcade/i18n` instead, so every game says it the same way.
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

  moves: 'MOVES',
  playerOne: 'Player 1',
  playerTwo: 'Player 2',
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

import type { ArcadeMessages } from './types'
import { coreEn } from '@src/i18n/coreLocales'

/** English strings, the arcade ships English only. */
export const en: ArcadeMessages = {
  ...coreEn,
  app: {
    title: 'Arcade',
  },
  arcade: {
    berlinOffice: 'Berlin Office',
    play: 'Play',
    players: 'Players',
    player: 'Player',
    or: 'or',
    gameOfTheDay: 'Game of the Day',
    filters: {
      label: 'Filter games',
      players: 'Players',
      playerCount: (n) => `${n} player${n === 1 ? '' : 's'}`,
      leaderboardAriaLabel: 'Only games with a leaderboard',
      ai: 'AI',
      aiAriaLabel: 'Only games you can play against the computer',
      noMatches: 'No games match these filters',
      clear: 'Clear filters',
    },
    returnToLauncher: 'Return to Launcher',
    confirm: 'Confirm',
    cancel: 'Cancel',
    tutorial: {
      title: 'How to play',
      close: 'Close',
      prev: 'Previous',
      next: 'Next',
    },
    leaderboard: {
      openLeaderboard: 'Leaderboard',
      title: 'Leaderboard',
      close: 'Close',
      empty: 'No scores yet',
      playAgain: 'Play again',
      menu: 'Main menu',
      unavailable: "Couldn't reach the leaderboard",
      wontBeSaved: 'Your score will not be saved',
      willBeSavedAs: (name) => `Will be saved as ${name}`,
      enterNameToSave: 'enter name to save',
      closeKeyboard: 'Close keyboard',
    },
  },
}

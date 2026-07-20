import type { ArcadeMessages } from './types'
import { coreEn } from '@src/i18n/coreLocales'

/** English strings — the arcade ships English only. */
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
    returnToLauncher: 'Return to Launcher',
    confirm: 'Confirm',
    cancel: 'Cancel',
  },
}

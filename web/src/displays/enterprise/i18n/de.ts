import type { EnterpriseMessages } from './types'
import { coreDe } from '@src/i18n/coreLocales'

/** German strings, the primary language of the Enterprise booth. */
export const de: EnterpriseMessages = {
  ...coreDe,
  app: {
    // Override the core "Barnguard" default with the event brand.
    // TODO: placeholder copy, pending final Enterprise brand text.
    title: 'Firefox Enterprise',
  },
  game: {
    title: 'Willkommen bei Firefox Enterprise',
    subtitle: 'Bringen Sie Ihre Daten sicher durchs Netzwerk.',
    startButton: 'Starten',
    idleHint: 'Wählen Sie ein Bundesland',
    loading: 'Karte wird geladen …',
    confirmStateTitle: 'Bereit für die Runde?',
    confirmStateHint:
      'Bringen Sie die Daten sicher in Ihr Bundesland, ohne dass sie kollidieren oder Deutschland verlassen.',
    confirmButton: 'Starten',
    cancelButton: 'Abbrechen',
    gameOverTitle: 'Datenverlust',
    gameOverExited: 'Die Daten haben Deutschland verlassen.',
    gameOverCollision: 'Zwei Datenpakete sind kollidiert.',
    tryAgainButton: 'Nochmal',
    point: 'Punkt',
    points: 'Punkte',
    highScoreLabel: 'High Score',
    stateHighScoreLabel: 'High Score {state}',
    newHighScoreBanner: 'Neuer High Score',
    continueButton: 'Weiter',
    pauseTitle: 'Pausiert',
    pauseHint: 'Zum Fortsetzen tippen.',
    resumeButton: 'Fortsetzen',
  },
  states: {
    BW: 'Baden-Württemberg',
    BY: 'Bayern',
    BE: 'Berlin',
    BB: 'Brandenburg',
    HB: 'Bremen',
    HH: 'Hamburg',
    HE: 'Hessen',
    MV: 'Mecklenburg-Vorpommern',
    NI: 'Niedersachsen',
    NW: 'Nordrhein-Westfalen',
    RP: 'Rheinland-Pfalz',
    SL: 'Saarland',
    SN: 'Sachsen',
    ST: 'Sachsen-Anhalt',
    SH: 'Schleswig-Holstein',
    TH: 'Thüringen',
  },
}

import type { Messages } from './types'

/** German strings — the primary language of the booth installation. */
export const de: Messages = {
  app: {
    title: 'Stallwächterparty',
  },
  game: {
    title: 'Willkommen bei der Stallwächterparty',
    subtitle:
      'Das politische Sommerfest der Landesvertretung Baden-Württemberg',
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
  attendant: {
    pauseAriaLabel: 'Spiel pausieren',
    resumeAriaLabel: 'Spiel fortsetzen',
    languageToggleAriaLabel: 'Sprache wechseln',
  },
  print: {
    printButton: 'Etikett drucken',
    printing: 'Wird gedruckt …',
    printed: 'Gedruckt ✓',
    printError: 'Druck fehlgeschlagen',
    retry: 'Erneut drucken',
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

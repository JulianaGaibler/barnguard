import type { StateId } from './game/data/states'

/**
 * English copy for Data Control. Self-contained plain object the components
 * import directly (the game doesn't depend on the arcade locale store).
 */
export const DATA_CONTROL_STRINGS = {
  title: 'DATA CONTROL',
  tagline: 'Route the data home. Keep control.',
  loading: 'Loading map…',
  play: 'Play',
  howToPlay: 'How to Play',
  openLeaderboard: 'Leaderboard',
  returnToLauncher: 'Return to Launcher',
  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit',
  playAgain: 'Play again',
  menu: 'Menu',
  gameOver: 'Data lost',
  score: 'Score',
  /** Bottom-corner prompt shown on the idle map. */
  idleHint: 'Choose a state',
  /** Confirm-card call to action. */
  start: 'Start',
  gameOverExited: 'The data left Germany.',
  gameOverCollision: 'Two data packets collided.',
  tutorial: {
    selectTitle: 'Pick a state',
    selectBody:
      'Tap a German state to defend it. The camera flies in and its capital lights up as the destination for incoming data.',
    routeTitle: 'Route the data',
    routeBody:
      'Data packets spawn across the country. Draw a path from a packet to steer it safely into the glowing capital to score.',
    avoidTitle: 'Keep control',
    avoidBody:
      'Never let two packets collide, and never let one leave Germany. Either one ends the run — see how many you can land.',
  },
  /** State names keyed by ISO code. */
  states: {
    BW: 'Baden-Württemberg',
    BY: 'Bavaria',
    BE: 'Berlin',
    BB: 'Brandenburg',
    HB: 'Bremen',
    HH: 'Hamburg',
    HE: 'Hesse',
    MV: 'Mecklenburg-Vorpommern',
    NI: 'Lower Saxony',
    NW: 'North Rhine-Westphalia',
    RP: 'Rhineland-Palatinate',
    SL: 'Saarland',
    SN: 'Saxony',
    ST: 'Saxony-Anhalt',
    SH: 'Schleswig-Holstein',
    TH: 'Thuringia',
  } satisfies Record<StateId, string>,
} as const

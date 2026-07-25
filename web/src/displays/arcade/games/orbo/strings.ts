/**
 * Orbo's UI copy. English-only, kept as a plain object the game's Svelte
 * components import directly — the game is self-contained and doesn't depend on
 * the arcade's `t` locale store.
 */
export const ORBO_STRINGS = {
  title: 'ORBO',
  loading: 'Loading …',
  mode1v1: 'Play 1v1',
  mode2v2: 'Play 2v2',
  returnToLauncher: 'Return to Launcher',
  howToPlay: 'How to play',
  teamL: 'Team Blue',
  teamR: 'Team Red',
  // Pause menu.
  paused: 'Paused',
  resume: 'Resume',
  quit: 'Quit to menu',
  // How-to-play cards.
  tutorial: {
    scoreTitle: 'Flick to score',
    scoreBody:
      'Take turns flicking orbs toward your zone. When everyone runs out, the game is over.',
    bumpTitle: 'Bump them out',
    bumpBody:
      'Orbs collide. Use yours to push opponents out of their zone or out of the way.',
    overshootTitle: 'Overshoot and lose it',
    overshootBody:
      "Flick too hard and your orb lands in the opponent's flicking area. They take it and can use it as their own.",
    livesTitle: 'Three lives',
    livesBody:
      "Orbs can be reclaimed again only three times total. After the third, it's off the board.",
    winTitle: 'Most orbs win',
    winBody:
      'Once all orbs have been played, the side with more in their zone takes the round.',
  },
} as const

export type OrboStrings = typeof ORBO_STRINGS

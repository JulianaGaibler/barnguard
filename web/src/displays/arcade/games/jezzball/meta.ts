import type { ThemePalette } from '@src/core/theme'
import type { GameModule } from '../GameModule'
import JezzBallGame from './JezzBallGame.svelte'
import thumbImage from './assets/thumb.png?url'

/**
 * JezzBall's look: a light ground with a hard ink frame and a single pink
 * accent (purple/blue for the two players). Applied by the arcade via
 * `themeScope`, so the shared menu/pause/score components render in this
 * palette with no per-component overrides. The canvas side reads the same
 * values from `game/tuning.ts`.
 */
const themeTokens: ThemePalette = {
  surface: '#DEDEDE',
  surfaceCard: '#F2F2F2',
  surfaceInverse: '#272727',
  scrim: 'rgba(39, 39, 39, 0.35)',

  text: '#272727',
  textSecondary: 'rgba(39, 39, 39, 0.65)',
  textInverse: '#FFFFFF',
  title: '#272727',

  border: 'rgba(39, 39, 39, 0.18)',
  accent: '#D61D5F',
  teamA: '#B106C7',
  teamB: '#026BE2',

  actionPrimary: '#D61D5F',
  actionPrimaryText: '#FFFFFF',
  actionPrimaryHover: '#C31050',
  actionPrimaryActive: '#A50D45',
  actionPrimaryDisabled: 'rgba(214, 29, 95, 0.4)',

  actionSecondary: '#272727',
  actionSecondaryText: '#272727',
  actionSecondaryHover: 'rgba(39, 39, 39, 0.08)',
  actionSecondaryActive: 'rgba(39, 39, 39, 0.16)',
  actionSecondaryDisabled: 'rgba(39, 39, 39, 0.35)',

  inputBg: '#FFFFFF',
  shadowCard: '0 0.5rem 2rem rgba(39, 39, 39, 0.18)',
  shadowPanel: '0 1rem 3rem rgba(39, 39, 39, 0.25)',
}

export const jezzballModule: GameModule = {
  meta: {
    id: 'jezzball',
    title: 'JezzBall',
    description:
      'Wall off the arena while dodging the bouncing balls. Trap empty space to claim it, reach 75% to clear the stage, and see how many stages you can survive.',
    players: '1-2',
    thumbColor: '#DDDDDD',
    thumbImage,
    themeTokens,
    supportsLeaderboard: true,
  },
  component: JezzBallGame,
}

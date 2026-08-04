import type { ThemePalette } from '@src/core/theme'
import type { GameModule } from '../GameModule'
import DataControlGame from './DataControlGame.svelte'
import thumbImage from './assets/thumb.png?url'

/**
 * Data Control's palette: black surface, white text, a green and a blue accent.
 * No alpha anywhere — shades are mixed against the black base with `color-mix`
 * so every colour is opaque (matches the canvas, which can't blend over a
 * translucent sky). Green is the primary action; blue is the map/destination
 * accent. These tokens style the shared DOM chrome (menu, pause, game-over) via
 * `themeScope`; the canvas map sets its own matching colours in `game/`.
 */
const K = '#050505' // black base
const W = '#FFFFFF' // white
const G = '#01CA05' // green accent (primary action)
const B = '#031BC4' // blue accent
const mix = (a: string, pct: number, b: string): string =>
  `color-mix(in srgb, ${a} ${pct}%, ${b})`

const themeTokens: ThemePalette = {
  surface: K,
  surfaceCard: mix(W, 7, K),
  surfaceInverse: W,
  scrim: mix(K, 85, B),

  text: W,
  textSecondary: mix(W, 62, K),
  textInverse: K,
  title: W,

  border: mix(W, 20, K),
  accent: G,

  actionPrimary: G,
  actionPrimaryText: K,
  actionPrimaryHover: mix(G, 85, K),
  actionPrimaryActive: mix(G, 70, K),
  actionPrimaryDisabled: mix(G, 40, K),

  actionSecondary: W,
  actionSecondaryText: W,
  actionSecondaryHover: mix(W, 12, K),
  actionSecondaryActive: mix(W, 20, K),
  actionSecondaryDisabled: mix(W, 35, K),

  inputBg: mix(W, 10, K),
  shadowCard: `0 0.5rem 2rem ${K}`,
  shadowPanel: `0 1rem 3rem ${K}`,
}

export const dataControlModule: GameModule = {
  meta: {
    id: 'data-control',
    title: 'Data Control',
    description:
      'Route incoming data packets safely into their target zone. Never let two collide or one slip past the border.',
    players: '1',
    thumbColor: '#050505',
    thumbImage,
    themeTokens,
    supportsLeaderboard: true,
  },
  component: DataControlGame,
}

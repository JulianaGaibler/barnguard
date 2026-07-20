import type { Theme } from '@src/core/theme'
import arcadeLogo from './assets/arcade-logo.svg?url'
import blankLogo from './assets/blank.svg?url'

/**
 * Light, sunset-tinted arcade chrome. The engine paints the animated
 * background; these `--color-*` roles drive the DOM launcher + overlays. The
 * arcade's primary action is a solid white pill; games layer team colors on top
 * per-game.
 */
export const arcadeTheme: Theme = {
  palette: {
    surface: '#eac6f2',
    surfaceCard: '#ffffff',
    surfaceInverse: '#010612',
    scrim: 'rgba(6, 8, 12, 0.35)',

    text: '#1c1c22',
    textSecondary: '#5a5560',
    textAccent: '#b76fd0',
    textLink: '#8a4fb0',
    textInverse: '#ffffff',

    border: 'rgba(28, 28, 34, 0.10)',
    accent: '#b76fd0',
    teamA: '#4a90e2',
    teamB: '#e24a4a',

    // Strong dark fill so a primary CTA reads on light cards (pause menu). The
    // splash's white "Play" pills use the `surface` variant instead.
    actionPrimary: '#1c1c22',
    actionPrimaryText: '#ffffff',
    actionPrimaryHover: '#2c2c34',
    actionPrimaryActive: '#000000',
    actionPrimaryDisabled: 'rgba(28, 28, 34, 0.4)',

    actionSecondary: '#1c1c22',
    actionSecondaryText: '#1c1c22',
    actionSecondaryHover: 'rgba(28, 28, 34, 0.08)',
    actionSecondaryActive: 'rgba(28, 28, 34, 0.16)',
    actionSecondaryDisabled: 'rgba(28, 28, 34, 0.35)',

    inputBg: '#ffffff',
    shadowCard: '0 0.5rem 2.5rem rgba(90, 40, 110, 0.18)',
    gradientPlay: 'linear-gradient(120deg, #f6cce1, #cfb5f3)',
  },
  assets: {
    // No core top-bar logo — the launcher renders its own header.
    topBarPrimary: blankLogo,
    coverLogo: arcadeLogo,
  },
  cover: {
    backgroundColor: '#eac6f2',
  },
}

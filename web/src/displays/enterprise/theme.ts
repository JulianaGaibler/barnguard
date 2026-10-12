import type { Theme } from '@src/core/theme'

/**
 * Baden-Württemberg gold/black palette + Firefox / Mozilla branding. The
 * primary action is dark with a gold label.
 */
export const enterpriseTheme: Theme = {
  palette: {
    surface: '#ffffff',
    surfaceCard: '#ffffff',
    surfaceInverse: '#010612',
    scrim: 'rgba(1, 6, 18, 0.55)',

    text: '#1c1c1c',
    textSecondary: '#4e4e4e',
    textAccent: '#d4a10a',
    textLink: '#9a6f00',
    textInverse: '#ffffff',

    border: 'rgba(0, 0, 0, 0.1)',
    accent: '#d4a10a',

    actionPrimary: '#1c1c1c',
    actionPrimaryText: '#ffd34d',
    actionPrimaryHover: '#333333',
    actionPrimaryActive: '#000000',
    actionPrimaryDisabled: 'rgba(28, 28, 28, 0.4)',

    actionSecondary: '#1c1c1c',
    actionSecondaryText: '#1c1c1c',
    actionSecondaryHover: 'rgba(28, 28, 28, 0.08)',
    actionSecondaryActive: 'rgba(28, 28, 28, 0.16)',
    actionSecondaryDisabled: 'rgba(28, 28, 28, 0.35)',

    inputBg: '#f2f0e9',
    // Pre-boot fallback only: the engine's own backdrop stage paints over
    // this the moment it renders its first frame (see
    // `background/Backdrop.svelte`).
    appBackdrop: '#FDCC9B',
    shadowCard:
      '0 0.3125rem 2.5rem #0000001a, inset 0 0.125rem 0 -0.0625rem #ffffff80',
    gradientResult:
      'linear-gradient(75deg, #FFEB49 -30.28%, #F60 119.37%, #FB2872 232.27%)',
  },
  assets: {},
}

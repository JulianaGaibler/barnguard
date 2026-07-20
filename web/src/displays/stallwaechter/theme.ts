import type { Theme } from '@src/core/theme'
import enterpriseLogo from './assets/enterprise-logo.svg?url'
import mozillaLogo from './assets/mozilla-logo.svg?url'
import flames from './assets/flames.svg?url'

/**
 * Baden-Württemberg gold/black palette + Firefox / Mozilla branding for the
 * Stallwächter 2026 booth. The primary action is dark with a gold label.
 */
export const stallwaechterTheme: Theme = {
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
    shadowCard:
      '0 0.3125rem 2.5rem #0000001a, inset 0 0.125rem 0 -0.0625rem #ffffff80',
    gradientResult:
      'linear-gradient(75deg, #FFEB49 -30.28%, #F60 119.37%, #FB2872 232.27%)',
  },
  assets: {
    topBarPrimary: enterpriseLogo,
    topBarSecondary: mozillaLogo,
    coverLogo: enterpriseLogo,
    coverAccent: flames,
  },
  cover: {
    backgroundColor: '#0d1c40',
    headline: 'Mehr Kontrolle über Datenflüsse und digitale Arbeit',
  },
}

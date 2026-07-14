import type { Theme } from '@src/core/theme'
import enterpriseLogo from './assets/enterprise-logo.svg?url'
import mozillaLogo from './assets/mozilla-logo.svg?url'
import flames from './assets/flames.svg?url'

/**
 * Baden-Württemberg gold/black palette + Firefox / Mozilla branding used for
 * the Stallwächter 2026 booth. Historical values from the retired
 * `styles/colors.scss`.
 */
export const stallwaechterTheme: Theme = {
  palette: {
    bg: '#ffffff',
    text: '#1c1c1c',
    'text-secondary': '#4e4e4e',
    'text-accent': '#d4a10a',
    'text-link': '#9a6f00',
    'action-primary': '#1c1c1c',
    'action-primary-text': '#ffd34d',
    'action-primary-hover': '#333333',
    'action-primary-active': '#000000',
    'action-secondary': '#1c1c1c',
    'action-secondary-text': '#1c1c1c',
    'action-secondary-hover': 'rgba(28, 28, 28, 0.08)',
    'action-secondary-active': 'rgba(28, 28, 28, 0.16)',
    'input-bg': '#f2f0e9',
    'card-border': 'rgba(0, 0, 0, 0.1)',
    'card-shadow': '0 5px 40px #0000001a, inset 0 2px 0 -1px #ffffff80',
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

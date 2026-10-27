import type { Theme } from '@src/core/theme'

/** The palette, by name, for screens that use a colour outside a theme role. */
export const PALETTE = {
  black: '#161616',
  maroon: '#330505',
  red: '#FF453F',
  orange: '#FF9456',
  linen: '#FAF0E6',
  // The brand's other colors, for the folders and badges.
  pink: '#FF99E1',
  mint: '#D9FFCC',
  green: '#00D32F',
  purple: '#AE4BEB',
  white: '#FFFFFF',
} as const

/** Black type on white, with red for actions and orange as the second accent. */
export const ageVerificationTheme: Theme = {
  palette: {
    surface: PALETTE.white,
    surfaceCard: PALETTE.linen,
    surfaceInverse: PALETTE.black,
    scrim: 'rgba(51, 5, 5, 0.55)',

    text: PALETTE.black,
    textSecondary: PALETTE.maroon,
    textAccent: PALETTE.red,
    textLink: PALETTE.red,
    textInverse: PALETTE.white,
    title: PALETTE.black,

    border: 'rgba(22, 22, 22, 0.15)',
    accent: PALETTE.red,

    actionPrimary: PALETTE.red,
    actionPrimaryText: PALETTE.white,
    actionPrimaryHover: '#E83C36',
    actionPrimaryActive: '#D0332E',
    actionPrimaryDisabled: 'rgba(255, 69, 63, 0.4)',

    actionSecondary: PALETTE.red,
    actionSecondaryText: PALETTE.red,
    actionSecondaryHover: 'rgba(255, 69, 63, 0.08)',
    actionSecondaryActive: 'rgba(255, 69, 63, 0.16)',
    actionSecondaryDisabled: 'rgba(255, 69, 63, 0.35)',

    inputBg: PALETTE.linen,
    appBackdrop: PALETTE.white,
    shadowCard: '0 0.3125rem 2.5rem rgba(22, 22, 22, 0.1)',
  },
  assets: {},
}

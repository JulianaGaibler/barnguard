import type { Theme } from '@src/core/theme'

/**
 * The palette, by name. Canvas nodes read these and the theme is built from
 * them.
 */
export const PALETTE = {
  ink: '#161616',
  maroon: '#2f1212',
  orange: '#f6a379',
  slate: '#63647e',
  cream: '#fffcec',
  paper: '#fffbf8',
  white: '#ffffff',
  /** The three ratings: poor, acceptable and good. */
  red: '#ff8575',
  yellow: '#fff175',
  green: '#75ffb5',
} as const

/** Light text on a near black screen, with the three rating colors as accents. */
export const contrastTheme: Theme = {
  palette: {
    surface: PALETTE.ink,
    surfaceCard: PALETTE.maroon,
    surfaceInverse: PALETTE.ink,
    scrim: 'rgba(22, 22, 22, 0.7)',

    text: PALETTE.white,
    textSecondary: PALETTE.cream,
    textAccent: PALETTE.yellow,
    textLink: PALETTE.yellow,
    textInverse: PALETTE.ink,
    title: PALETTE.white,

    border: 'rgba(255, 255, 255, 0.25)',
    accent: PALETTE.yellow,

    actionPrimary: PALETTE.white,
    actionPrimaryText: PALETTE.ink,
    actionPrimaryHover: PALETTE.cream,
    actionPrimaryActive: PALETTE.paper,
    actionPrimaryDisabled: 'rgba(255, 255, 255, 0.4)',

    actionSecondary: PALETTE.white,
    actionSecondaryText: PALETTE.white,
    actionSecondaryHover: 'rgba(255, 255, 255, 0.08)',
    actionSecondaryActive: 'rgba(255, 255, 255, 0.16)',
    actionSecondaryDisabled: 'rgba(255, 255, 255, 0.35)',

    inputBg: PALETTE.maroon,
    appBackdrop: PALETTE.ink,
  },
  assets: {},
}

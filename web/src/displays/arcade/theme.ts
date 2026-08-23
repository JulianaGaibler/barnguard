import type { Theme, ThemePalette } from '@src/core/theme'
import arcadeLogo from './assets/arcade-logo.svg?url'

/**
 * Light, sunset-tinted arcade chrome. The engine paints the animated
 * background. These `--color-*` roles drive the DOM launcher + overlays. The
 * arcade's primary action is a solid white pill, games layer team colors on top
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
    // No core top-bar logo, the launcher renders its own header.
    coverLogo: arcadeLogo,
  },
  cover: {
    backgroundColor: '#eac6f2',
  },
}

/**
 * The launcher's chrome once the sky goes dark. Scoped to the launcher subtree
 * with `themeScope`, so overlays and in-game surfaces keep the light roles.
 *
 * Every role the light palette sets is set again here. `applyPalette` only ever
 * writes custom properties and never removes one, so a partial set would leave
 * stale light values behind when the launcher switches back.
 */
export const arcadeNightPalette: ThemePalette = {
  ...arcadeTheme.palette,

  surface: '#101430',
  // Tuned against the night plateau, where the sky rests for hours, rather than
  // against the dusk sweep it unavoidably crosses once. See `theme.test.ts`.
  surfaceCard: '#464080',
  surfaceInverse: '#f4f1ff',
  scrim: 'rgba(4, 5, 14, 0.55)',

  text: '#f2eefc',
  textSecondary: '#b0a8c8',
  textAccent: '#d9a8ea',
  textLink: '#c79ae0',
  textInverse: '#14122a',

  border: 'rgba(242, 238, 252, 0.14)',
  accent: '#d9a8ea',

  actionPrimary: '#f2eefc',
  actionPrimaryText: '#14122a',
  actionPrimaryHover: '#ffffff',
  actionPrimaryActive: '#ddd6ee',
  actionPrimaryDisabled: 'rgba(242, 238, 252, 0.35)',

  actionSecondary: '#f2eefc',
  actionSecondaryText: '#f2eefc',
  actionSecondaryHover: 'rgba(242, 238, 252, 0.12)',
  actionSecondaryActive: 'rgba(242, 238, 252, 0.2)',
  actionSecondaryDisabled: 'rgba(242, 238, 252, 0.3)',

  inputBg: '#1b1836',
  // Even at its best the fill only clears the sky by about 1.9, so a hairline
  // rim carries the card's edge outright. The drop shadow alone cannot, being
  // dark against a dark sky.
  shadowCard:
    '0 0 0 1px rgba(242, 238, 252, 0.16), 0 0.5rem 2.5rem rgba(0, 0, 0, 0.5)',
  // The play pill carries `--color-text` as its label, so this stays dark
  // enough for light text while still reading brighter than the card.
  gradientPlay: 'linear-gradient(120deg, #443a86, #7256b8)',
}

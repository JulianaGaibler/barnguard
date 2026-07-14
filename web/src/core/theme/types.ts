/**
 * Per-display theme: palette + branded imagery + optional layout hints. Every
 * display module exports one of these; the resolved theme is applied to `:root`
 * as `--tint-*` CSS custom properties and mirrored in a Svelte store so image
 * URLs can be read from components.
 *
 * The palette keys mirror the historical `styles/colors.scss` map so existing
 * CSS references (`var(--tint-action-primary)`, etc.) keep working.
 */
export interface ThemePalette {
  bg: string
  text: string
  'text-secondary': string
  'text-accent': string
  'text-link': string
  'action-primary': string
  'action-primary-text': string
  'action-primary-hover': string
  'action-primary-active': string
  'action-secondary': string
  'action-secondary-text': string
  'action-secondary-hover': string
  'action-secondary-active': string
  'input-bg': string
  'card-border': string
  'card-shadow': string
}

/**
 * Branded imagery slots the core chrome (TopBar, CoverScreen) paints. Each URL
 * is a resolved asset URL (`import x from '…?url'`), never a path string.
 */
export interface ThemeAssets {
  /** Primary logo shown top-left. */
  topBarPrimary: string
  /** Secondary logo shown top-right (falsy → not rendered). */
  topBarSecondary?: string
  /** Cover-screen logo, typically a larger vector version of `topBarPrimary`. */
  coverLogo: string
  /** Cover-screen decorative overlay (falsy → not rendered). */
  coverAccent?: string
}

/**
 * Cover-screen chrome: solid backdrop + brand headline shown behind the "we're
 * off-duty" card. Kept on the theme because both are strong brand statements.
 */
export interface ThemeCover {
  backgroundColor: string
  headline: string
}

export interface Theme {
  palette: ThemePalette
  assets: ThemeAssets
  cover: ThemeCover
}

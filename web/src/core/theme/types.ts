/**
 * Per-display theme: color roles + branded imagery + cover chrome. Every
 * display module exports one. The palette is an OVERRIDE set: `applyTheme`
 * writes each provided role to `:root` as a `--color-*` custom property, and
 * any role left out keeps the neutral default from `styles/scale.sass`. So a
 * theme only lists what differs, and no `var(--color-*)` is ever undefined.
 *
 * Keys are camelCase and map to kebab-case CSS variables (e.g. `textSecondary`
 * → `--color-text-secondary`, `shadowCard` → `--color-shadow-card`).
 */
export interface ThemePalette {
  /** App background behind everything. */
  surface?: string
  /** Raised card / panel background. */
  surfaceCard?: string
  /** Dark panel background (game-over / pause cards). */
  surfaceInverse?: string
  /** Full-screen modal backdrop. */
  scrim?: string

  text?: string
  textSecondary?: string
  textAccent?: string
  textLink?: string
  /** Text on `surfaceInverse` / dark panels. */
  textInverse?: string

  border?: string
  accent?: string
  /** Two-sided game colors (left/blue, right/red). */
  teamA?: string
  teamB?: string

  actionPrimary?: string
  actionPrimaryText?: string
  actionPrimaryHover?: string
  /** Pressed / touch-down feedback (a touch UI has no hover). */
  actionPrimaryActive?: string
  actionPrimaryDisabled?: string

  actionSecondary?: string
  actionSecondaryText?: string
  actionSecondaryHover?: string
  actionSecondaryActive?: string
  actionSecondaryDisabled?: string

  inputBg?: string
  shadowCard?: string
  /** Heavier shadow for large modal panels. */
  shadowPanel?: string
  /** App-wide DOM backdrop (gradient or color). */
  appBackdrop?: string

  /** Decorative gradients (launcher play button, result card). */
  gradientPlay?: string
  gradientResult?: string
}

/**
 * Branded imagery the core chrome (TopBar, CoverScreen) paints. Each is a
 * resolved asset URL (`import x from '…?url'`), never a path string.
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
 * Cover-screen chrome: solid backdrop + brand headline shown behind the
 * off-duty card.
 */
export interface ThemeCover {
  backgroundColor: string
  /** Brand headline behind the off-duty card; omit for none. */
  headline?: string
}

export interface Theme {
  palette: ThemePalette
  assets: ThemeAssets
  cover: ThemeCover
}

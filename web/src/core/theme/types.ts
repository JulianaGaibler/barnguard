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
  /** Menu/heading title color. Falls back to `text` when unset. */
  title?: string

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
  /**
   * App-wide DOM backdrop (gradient or color), painted behind everything by
   * `BackgroundLayer` and by the pre-mount landing/error screens. Defaults to a
   * neutral dark. A display with branded chrome sets its own here and pairs it
   * with `DisplayManifest.backdrop`.
   */
  appBackdrop?: string

  /** Decorative gradients (launcher play button, result card). */
  gradientPlay?: string
  gradientResult?: string
}

/**
 * Per-display / per-game font roles. Like {@link ThemePalette}, an OVERRIDE set:
 * `applyFonts` writes each provided role to an element as a `--font-*` custom
 * property, and a role left out keeps the default from `styles/scale.sass`.
 *
 * Only two roles, on purpose. These are the defaults nearly all copy inherits,
 * and they are the whole of what a theme decides. Anything more specific — a
 * monospace readout, a wide face for a score, one game's display type — names
 * the family it wants directly, via `var(--font-geist)` in CSS or
 * `FAMILIES.geist` on canvas. See `theme/fonts.ts`.
 *
 * Values are FULL CSS font-family stacks, fallbacks included: a display face
 * wants a different fallback tail than a body face, and the canvas needs one
 * string it can drop into a `font` shorthand.
 */
export interface ThemeFonts {
  /** Body copy, UI, buttons, labels. */
  text?: string
  /** Titles, headings, card titles, anything set large. */
  heading?: string
}

/**
 * Branded imagery the core chrome (TopBar, CoverScreen) paints. Each is a
 * resolved asset URL (`import x from '…?url'`), never a path string.
 */
export interface ThemeAssets {
  /** Primary logo shown top-left (falsy → not rendered). */
  topBarPrimary?: string
  /** Secondary logo shown top-right (falsy → not rendered). */
  topBarSecondary?: string
  /**
   * Cover-screen logo, typically a larger vector version of `topBarPrimary`
   * (falsy → not rendered).
   */
  coverLogo?: string
  /** Cover-screen decorative overlay (falsy → not rendered). */
  coverAccent?: string
}

/**
 * Cover-screen chrome: solid backdrop + brand headline shown behind the
 * off-duty card.
 */
export interface ThemeCover {
  backgroundColor: string
  /** Brand headline behind the off-duty card, omit for none. */
  headline?: string
}

export interface Theme {
  palette: ThemePalette
  /**
   * Font-role overrides. Optional: a display that wants the stock Mozilla type
   * omits it entirely and inherits every default from `styles/scale.sass`.
   */
  fonts?: ThemeFonts
  assets: ThemeAssets
  cover: ThemeCover
}

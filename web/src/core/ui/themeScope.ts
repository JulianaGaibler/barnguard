import type { Action } from 'svelte/action'
import {
  applyFonts,
  applyPalette,
  type ThemeFonts,
  type ThemePalette,
} from '@src/core/theme'

/**
 * Scope a partial palette to an element's subtree. The display theme sets the
 * `--color-*` roles on `:root`, and this writes a game's overrides onto its own
 * container so they win inside it (team colors, accents) without touching the
 * rest of the app. Custom properties inherit through `display: contents`, so
 * the host element can be layout-neutral.
 *
 * A future `variant` preset (a standard dark/light neutral set) can be merged
 * in here before the per-game accents.
 */
export const themeScope: Action<HTMLElement, ThemePalette | undefined> = (
  node,
  tokens,
) => {
  if (tokens) applyPalette(node, tokens)
  return {
    update(next) {
      if (next) applyPalette(node, next)
    },
  }
}

/**
 * Scope partial font roles to an element's subtree, the `--font-*` counterpart
 * to {@link themeScope}. Kept a separate action rather than folding fonts into
 * `themeScope`'s parameter so existing call sites keep their shape; Svelte
 * takes both actions on one node.
 *
 * This covers the game's DOM overlays only. Its canvas nodes resolve the same
 * roles through `resolveFonts`/`fontFor`, from the same `ThemeFonts` constant,
 * because the engine canvas sits outside this subtree.
 */
export const fontScope: Action<HTMLElement, ThemeFonts | undefined> = (
  node,
  tokens,
) => {
  if (tokens) applyFonts(node, tokens)
  return {
    update(next) {
      if (next) applyFonts(node, next)
    },
  }
}

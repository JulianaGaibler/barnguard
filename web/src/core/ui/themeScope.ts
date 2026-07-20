import type { Action } from 'svelte/action'
import { applyPalette, type ThemePalette } from '@src/core/theme'

/**
 * Scope a partial palette to an element's subtree. The display theme sets the
 * `--color-*` roles on `:root`; this writes a game's overrides onto its own
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

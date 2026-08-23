import { writable, type Readable } from 'svelte/store'
import type { Theme, ThemeFonts, ThemePalette } from './types'

export type {
  Theme,
  ThemePalette,
  ThemeFonts,
  ThemeAssets,
  ThemeCover,
} from './types'
export {
  DEFAULT_FONTS,
  FAMILIES,
  FONT_CATALOGUE,
  FONT_ROLES,
  fontFor,
  fontWith,
  isVariableWeights,
  primaryFamily,
  resolveFonts,
  type FamilyId,
  type FontRole,
  type FontFamilyEntry,
  type FontWeights,
  type ResolvedFonts,
  type VariableWeights,
} from './fonts'

const themeStore = writable<Theme | null>(null)

/** Read-only handle for components. `null` before `applyTheme` has been called. */
export const theme: Readable<Theme | null> = { subscribe: themeStore.subscribe }

const kebab = (key: string): string =>
  key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

/**
 * Write a token set to an element as `--<prefix>-*` custom properties. Only
 * ever sets, never removes, so a partial second set leaves earlier values in
 * place. That is deliberate: a target keeps whatever it inherits (the
 * scale.sass defaults, or the display theme for a game scope) for any role the
 * caller leaves out.
 */
function applyTokens<T extends object>(
  el: HTMLElement,
  prefix: string,
  tokens: T,
): void {
  for (const [key, value] of Object.entries(tokens) as [string, unknown][]) {
    if (typeof value !== 'string') continue
    el.style.setProperty(`--${prefix}-${kebab(key)}`, value)
  }
}

/**
 * Write a palette's roles to an element as `--color-*` custom properties. Used
 * at boot for the display theme (on `:root`) and for per-game overrides (on a
 * scoped container).
 */
export function applyPalette(el: HTMLElement, palette: ThemePalette): void {
  applyTokens(el, 'color', palette)
}

/**
 * Write a font-role set to an element as `--font-*` custom properties. The DOM
 * half of the font system; canvas code resolves the same roles through
 * `resolveFonts`/`fontFor` in `theme/fonts.ts`, because the engine canvas sits
 * outside every scoped container and cannot read these back.
 */
export function applyFonts(el: HTMLElement, fonts: ThemeFonts): void {
  applyTokens(el, 'font', fonts)
}

/**
 * Install a display theme: write its palette and fonts to `:root` and publish
 * it to the store so components can read logo URLs. Called once by `main.ts`
 * before the app mounts.
 */
export function applyTheme(next: Theme): void {
  applyPalette(document.documentElement, next.palette)
  if (next.fonts) applyFonts(document.documentElement, next.fonts)
  themeStore.set(next)
}

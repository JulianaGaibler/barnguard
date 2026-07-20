import { writable, type Readable } from 'svelte/store'
import type { Theme, ThemePalette } from './types'

export type { Theme, ThemePalette, ThemeAssets, ThemeCover } from './types'

const themeStore = writable<Theme | null>(null)

/** Read-only handle for components. `null` before `applyTheme` has been called. */
export const theme: Readable<Theme | null> = { subscribe: themeStore.subscribe }

const kebab = (key: string): string =>
  key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)

/**
 * Write a palette's roles to an element as `--color-*` custom properties. Used
 * at boot for the display theme (on `:root`) and for per-game overrides (on a
 * scoped container). Unset roles are skipped, so the target keeps whatever it
 * inherits (the scale.sass defaults, or the display theme for a game scope).
 */
export function applyPalette(el: HTMLElement, palette: ThemePalette): void {
  for (const [key, value] of Object.entries(palette)) {
    if (value == null) continue
    el.style.setProperty(`--color-${kebab(key)}`, value)
  }
}

/**
 * Install a display theme: write its palette to `:root` as `--color-*` and
 * publish it to the store so components can read logo URLs. Called once by
 * `main.ts` before the app mounts.
 */
export function applyTheme(next: Theme): void {
  applyPalette(document.documentElement, next.palette)
  themeStore.set(next)
}

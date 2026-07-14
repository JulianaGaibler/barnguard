import { writable, type Readable } from 'svelte/store'
import type { Theme } from './types'

export type { Theme, ThemePalette, ThemeAssets, ThemeCover } from './types'

const themeStore = writable<Theme | null>(null)

/** Read-only handle for components. `null` before `applyTheme` has been called. */
export const theme: Readable<Theme | null> = { subscribe: themeStore.subscribe }

/**
 * Install a theme: write its palette to `:root` as `--tint-*` CSS custom
 * properties and publish it to the store so components can read logo URLs.
 * Called once by `main.ts` before the app mounts.
 */
export function applyTheme(next: Theme): void {
  const root = document.documentElement
  for (const [key, value] of Object.entries(next.palette)) {
    root.style.setProperty(`--tint-${key}`, value)
  }
  themeStore.set(next)
}

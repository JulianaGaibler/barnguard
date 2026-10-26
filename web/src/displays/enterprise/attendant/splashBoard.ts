/**
 * Whether the splash shows the map's top three in its corner. On by default,
 * and kept per device so it survives a reload.
 */

import { writable } from 'svelte/store'

const STORAGE_KEY = 'bg.enterprise.splashBoard'

function read(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== '0'
  } catch {
    return true
  }
}

export const splashBoardEnabled = writable(read())

export function setSplashBoardEnabled(enabled: boolean): void {
  splashBoardEnabled.set(enabled)
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0')
  } catch {
    /* storage blocked, the toggle still applies for this session */
  }
}

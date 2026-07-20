import { writable } from 'svelte/store'

/**
 * Runtime UI-scale multiplier. The root font-size is `clamp(...) *
 * var(--ui-scale)` (see styles/global.sass) and every token is rem, so this one
 * knob scales the whole visitor DOM UI. It's tuned on the kiosk from the booth
 * menu and persisted per device; a blocking script in index.html applies the
 * stored value before first paint (no flash of unscaled content).
 */
const STORAGE_KEY = 'bg.uiScale'
export const UI_SCALE_MIN = 0.6
export const UI_SCALE_MAX = 1.8
export const UI_SCALE_STEP = 0.05

const clamp = (v: number): number =>
  Math.min(UI_SCALE_MAX, Math.max(UI_SCALE_MIN, v))

function readStored(): number {
  try {
    const s = Number.parseFloat(localStorage.getItem(STORAGE_KEY) ?? '')
    return Number.isFinite(s) && s > 0 ? clamp(s) : 1
  } catch {
    return 1
  }
}

export const uiScale = writable<number>(readStored())

export function setUiScale(v: number): void {
  uiScale.set(clamp(v))
}

export function resetUiScale(): void {
  uiScale.set(1)
}

let started = false
/**
 * Begin mirroring the store to the document and localStorage. Call once at boot
 * (main.ts). Idempotent.
 */
export function startUiScale(): void {
  if (started || typeof document === 'undefined') return
  started = true
  uiScale.subscribe((v) => {
    document.documentElement.style.setProperty('--ui-scale', String(v))
    try {
      localStorage.setItem(STORAGE_KEY, String(v))
    } catch {
      /* storage blocked; the value still applies for this session */
    }
  })
}

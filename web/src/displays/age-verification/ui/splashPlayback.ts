import { writable } from 'svelte/store'

/**
 * Whether the splash animation is held still, and the frame it is held at, for
 * a booth where the motion would wear on people over a long day. It is kept in
 * the browser's storage, so a reload or a restart of the game finds it the way
 * it was left.
 */
export interface SplashPlayback {
  paused: boolean
  /** The frame the animation stopped at. Only meaningful while paused. */
  frame: number
}

const STORAGE_KEY = 'bg.age-verification.splash'

export const PLAYING: SplashPlayback = { paused: false, frame: 0 }

/** What storage holds, or playing if it holds nothing usable. */
export function parsePlayback(raw: string | null): SplashPlayback {
  if (!raw) return PLAYING
  try {
    const value = JSON.parse(raw) as Partial<SplashPlayback> | null
    const frame = Number(value?.frame)
    return {
      paused: value?.paused === true,
      frame: Number.isFinite(frame) && frame >= 0 ? frame : 0,
    }
  } catch {
    return PLAYING
  }
}

function readStored(): SplashPlayback {
  try {
    return parsePlayback(localStorage.getItem(STORAGE_KEY))
  } catch {
    return PLAYING
  }
}

export const splashPlayback = writable<SplashPlayback>(readStored())

splashPlayback.subscribe((value) => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value))
  } catch {
    /* storage blocked, the setting still applies for this session */
  }
})

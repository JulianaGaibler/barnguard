/**
 * Client-facing daemon config, mirrored from the printer-daemon.
 *
 * The daemon owns these values in its `config.toml` (`[client]` section) and
 * pushes them over the SSE stream: once in the connect snapshot, then again
 * whenever an operator hits "Reload config" in the attendant panel. This store
 * holds the latest values. `printerClient`'s SSE listener writes them via
 * {@link setDaemonConfig}, and consumers (e.g. the label renderer) read from
 * it.
 *
 * Until the first SSE snapshot arrives, or if the daemon is unreachable, the
 * store keeps its defaults, so labels and the arcade sky always have sane
 * values.
 *
 * Plain `writable` (not runes) to match the other `stores/` modules and to be
 * readable via `get()` from non-component code (the SSE listener, the
 * renderer).
 */

import { writable } from 'svelte/store'

/** Fallback label URL until the daemon sends its config (or if it's offline). */
export const DEFAULT_LABEL_URL = 'mzl.la/enterprise'

/** Fallback booth position and zone. Berlin Alexanderplatz. */
export const DEFAULT_LATITUDE = 52.52
export const DEFAULT_LONGITUDE = 13.405
export const DEFAULT_TIMEZONE = 'Europe/Berlin'

export interface DaemonConfig {
  /**
   * Effective URL printed top-right on every result label. The runtime override
   * if one is set, otherwise the daemon's `config.toml` value.
   */
  labelUrl: string
  /**
   * True when an in-memory override (set from the Printer panel) is superseding
   * the `config.toml` value. Lets the UI show the state and offer a reset.
   */
  labelUrlOverridden: boolean
  /** Booth latitude in degrees, north positive. Positions the arcade's sun. */
  latitude: number
  /** Booth longitude in degrees, east positive. */
  longitude: number
  /**
   * IANA zone name. Only the arcade's wall-clock dev overrides resolve against
   * it, since the sky itself runs on an absolute clock.
   */
  timezone: string
}

const DEFAULTS: DaemonConfig = {
  labelUrl: DEFAULT_LABEL_URL,
  labelUrlOverridden: false,
  latitude: DEFAULT_LATITUDE,
  longitude: DEFAULT_LONGITUDE,
  timezone: DEFAULT_TIMEZONE,
}

export const daemonConfig = writable<DaemonConfig>(DEFAULTS)

/**
 * Merge a snapshot over the defaults. The SSE frame is cast rather than
 * validated, so a daemon older than a field would otherwise write `undefined`
 * into it. Merging keeps every key at a usable value.
 */
export function setDaemonConfig(config: Partial<DaemonConfig>): void {
  const merged = { ...DEFAULTS }
  for (const key of Object.keys(DEFAULTS) as (keyof DaemonConfig)[]) {
    const value = config[key]
    if (value !== undefined && value !== null) {
      // Each key keeps its own type, which the loop cannot express.
      ;(merged as Record<string, unknown>)[key] = value
    }
  }
  daemonConfig.set(merged)
}

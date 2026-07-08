/**
 * Client-facing daemon config, mirrored from the printer-daemon.
 *
 * The daemon owns these values in its `config.toml` (`[client]` section) and
 * pushes them over the SSE stream: once in the connect snapshot, then again
 * whenever an operator hits "Reload config" in the attendant panel. This store
 * holds the latest values; `printerClient`'s SSE listener writes them via
 * {@link setDaemonConfig}, and consumers (e.g. the label renderer) read from
 * it.
 *
 * Until the first SSE snapshot arrives — or if the daemon is unreachable — the
 * store keeps {@link DEFAULT_LABEL_URL}, so labels always have a sane value.
 *
 * Plain `writable` (not runes) to match the other `stores/` modules and to be
 * readable via `get()` from non-component code (the SSE listener, the
 * renderer).
 */

import { writable } from 'svelte/store'

/** Fallback label URL until the daemon sends its config (or if it's offline). */
export const DEFAULT_LABEL_URL = 'mzl.la/enterprise'

export interface DaemonConfig {
  /**
   * Effective URL printed top-right on every result label — the runtime
   * override if one is set, otherwise the daemon's `config.toml` value.
   */
  labelUrl: string
  /**
   * True when an in-memory override (set from the Printer panel) is superseding
   * the `config.toml` value. Lets the UI show the state and offer a reset.
   */
  labelUrlOverridden: boolean
}

export const daemonConfig = writable<DaemonConfig>({
  labelUrl: DEFAULT_LABEL_URL,
  labelUrlOverridden: false,
})

export function setDaemonConfig(config: DaemonConfig): void {
  daemonConfig.set(config)
}

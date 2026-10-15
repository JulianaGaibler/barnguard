// Shared value formatters for the debug HUD panels.

/** Placeholder for a value that can't be computed yet (no samples, etc.). */
export const MISSING = '—'

export function fmtMs(sec: number): string {
  return `${(sec * 1000).toFixed(2)}ms`
}

export function fmtFps(sec: number): string {
  if (sec <= 0) return MISSING
  return Math.round(1 / sec).toString()
}

export function fmtCoord(n: number): string {
  return n.toFixed(1)
}

export function fmtPair(p: { x: number; y: number } | null): string {
  return p ? `${p.x.toFixed(1)}, ${p.y.toFixed(1)}` : MISSING
}

/** A number split from its unit, so a card can render the unit small and dim. */
export interface Quantity {
  text: string
  unit: string
}

/** `n` with enough decimals to show about three significant digits. */
function sig(n: number): string {
  const a = Math.abs(n)
  if (a >= 100) return n.toFixed(0)
  if (a >= 10) return n.toFixed(1)
  return n.toFixed(2)
}

/** A byte count in B, KB, MB or GB, moving up at 1024 of the smaller unit. */
export function bytesQuantity(bytes: number): Quantity {
  const a = Math.abs(bytes)
  if (a < 1024) return { text: String(Math.round(bytes)), unit: 'B' }
  if (a < 1024 * 1024) return { text: sig(bytes / 1024), unit: 'KB' }
  if (a < 1024 ** 3) return { text: sig(bytes / 1024 ** 2), unit: 'MB' }
  return { text: sig(bytes / 1024 ** 3), unit: 'GB' }
}

/** A count, shortened to k or M from 10 000. */
export function countQuantity(n: number): Quantity {
  const a = Math.abs(n)
  if (a < 10_000) return { text: String(Math.round(n)), unit: '' }
  if (a < 1_000_000) return { text: sig(n / 1000), unit: 'k' }
  return { text: sig(n / 1_000_000), unit: 'M' }
}

/** Milliseconds, or seconds from 1000. */
export function msQuantity(ms: number): Quantity {
  if (Math.abs(ms) >= 1000) return { text: sig(ms / 1000), unit: 's' }
  return { text: sig(ms), unit: 'ms' }
}

/** A ratio in `[0, 1]` as a percentage. */
export function pctQuantity(ratio: number): Quantity {
  const p = ratio * 100
  return { text: Math.abs(p) >= 100 ? p.toFixed(0) : p.toFixed(1), unit: '%' }
}

/** A quantity as one string, `12.4 KB`. */
export function joinQuantity(q: Quantity): string {
  return q.unit === '' ? q.text : `${q.text} ${q.unit}`
}

export const fmtBytes = (bytes: number): string =>
  joinQuantity(bytesQuantity(bytes))
export const fmtCount = (n: number): string => joinQuantity(countQuantity(n))
export const fmtPct = (ratio: number): string =>
  joinQuantity(pctQuantity(ratio))

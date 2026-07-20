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

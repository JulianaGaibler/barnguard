import { THRESHOLDS, toneFor, type MetricId } from './thresholds'
import type { TipSpec } from './ui/tip'

/**
 * The tooltip for a metric: its name, the reading, what it counts, and the
 * threshold scale with the reading marked on it. A metric whose good and
 * warning thresholds are the same (any value above it is bad) has no scale
 * worth drawing, so it gets none.
 */
export function thresholdTip(
  id: MetricId,
  value: number,
  format: (n: number) => string = (n) => String(Math.round(n)),
): TipSpec {
  const t = THRESHOLDS[id]
  const lowIsBad = 'lowIsBad' in t && t.lowIsBad === true
  const max = lowIsBad ? 1 : Math.max(t.warn * 1.6, value * 1.05, 1)
  return {
    title: t.label,
    value: format(value),
    tone: toneFor(t, value),
    body: t.tip,
    scale:
      t.good === t.warn
        ? undefined
        : { value, good: t.good, warn: t.warn, max, lowIsBad, format },
  }
}

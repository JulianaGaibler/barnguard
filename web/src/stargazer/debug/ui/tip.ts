import type { Tone } from '../thresholds'

/**
 * A threshold scale drawn in a tip: the good, warning and bad zones with the
 * reading marked.
 */
export interface TipScale {
  value: number
  good: number
  warn: number
  /** The value at the right end of the scale. */
  max: number
  /** A high reading is the healthy one, so the zones run the other way. */
  lowIsBad?: boolean
  format: (n: number) => string
}

/** A table drawn in a tip, for comparing options. */
export interface TipTable {
  head: readonly string[]
  rows: readonly (readonly string[])[]
  /** The row to highlight, the option in effect. */
  current?: number
}

/**
 * What a tooltip shows: formatted text and, where it helps, a picture of the
 * scale.
 */
export interface TipSpec {
  title?: string
  /** The reading, shown beside the title. */
  value?: string
  tone?: Tone
  /** What the number counts and when it is bad. */
  body?: string
  scale?: TipScale
  facts?: readonly { label: string; value: string; tone?: Tone }[]
  table?: TipTable
}

/** A tip given as bare text is a body with nothing else. */
export function asTip(tip: TipSpec | string | undefined): TipSpec | null {
  if (tip === undefined) return null
  return typeof tip === 'string' ? { body: tip } : tip
}

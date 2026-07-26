/** Formats a score with a thousands separator, e.g. 2043 -> "2.043". */
const formatter = new Intl.NumberFormat('de-DE')

export function formatScore(score: number): string {
  return formatter.format(score)
}

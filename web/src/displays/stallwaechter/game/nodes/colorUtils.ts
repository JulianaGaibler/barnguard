/**
 * Convert a 3- or 6-digit hex colour (with or without the leading `#`) into an
 * `rgba(r, g, b, a)` string. Clamps alpha to `[0, 1]`. Small, allocation-
 * light, no arrays, no regex, so it's cheap to call inside per-frame draw
 * code.
 */
export function withAlpha(hex: string, alpha: number): string {
  const a = alpha < 0 ? 0 : alpha > 1 ? 1 : alpha
  const s = hex.charCodeAt(0) === 35 /* '#' */ ? hex.slice(1) : hex
  const r = parseInt(s.length === 3 ? s[0] + s[0] : s.slice(0, 2), 16)
  const g = parseInt(s.length === 3 ? s[1] + s[1] : s.slice(2, 4), 16)
  const b = parseInt(s.length === 3 ? s[2] + s[2] : s.slice(4, 6), 16)
  return `rgba(${r},${g},${b},${a})`
}

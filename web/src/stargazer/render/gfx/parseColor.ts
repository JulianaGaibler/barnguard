/**
 * Normalize a CSS color string to `{r,g,b,a}` in `0..1`. Not premultiplied.
 * Callers multiply by the current alpha stack when packing vertex/instance
 * colors.
 *
 * The GPU backend calls this from `Gfx2D` methods that take a `color: string`.
 * A small internal cache absorbs the hot path where the grid overlay hits the
 * same handful of colors every frame.
 *
 * Supported forms (observed in the game):
 *
 * - `#rgb`
 * - `#rrggbb`
 * - `#rrggbbaa`
 * - `rgba(r, g, b, a)` , r,g,b in `0..255`, a in `0..1`
 * - `rgb(r, g, b)`
 *
 * Unsupported input falls back to opaque black and warns exactly once per
 * unrecognized token.
 */

export interface RGBA {
  r: number
  g: number
  b: number
  a: number
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 }

// Small string → RGBA cache. Bounded so a pathological caller can't blow up
// the working set; the game realistically visits <100 distinct strings.
const CACHE_MAX = 256
const cache = new Map<string, RGBA>()

const warned = new Set<string>()

export function parseColor(css: string): RGBA {
  const hit = cache.get(css)
  if (hit) return hit
  const parsed = parseSlow(css) ?? warnFallback(css)
  if (cache.size >= CACHE_MAX) {
    // Cheap eviction: drop the oldest inserted key.
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(css, parsed)
  return parsed
}

function warnFallback(css: string): RGBA {
  if (!warned.has(css)) {
    warned.add(css)
    console.warn(
      `parseColor: unsupported color '${css}', falling back to black`,
    )
  }
  return BLACK
}

function parseSlow(css: string): RGBA | null {
  const s = css.trim()
  if (s.length === 0) return null
  if (s.charCodeAt(0) === 0x23 /* # */) return parseHex(s)
  if (s.startsWith('rgba')) return parseRgbFn(s, true)
  if (s.startsWith('rgb')) return parseRgbFn(s, false)
  return null
}

function parseHex(s: string): RGBA | null {
  const hex = s.slice(1)
  if (hex.length === 3) {
    const r = h1(hex.charCodeAt(0))
    const g = h1(hex.charCodeAt(1))
    const b = h1(hex.charCodeAt(2))
    if (r < 0 || g < 0 || b < 0) return null
    return { r: (r * 17) / 255, g: (g * 17) / 255, b: (b * 17) / 255, a: 1 }
  }
  if (hex.length === 6) {
    const r = h2(hex, 0)
    const g = h2(hex, 2)
    const b = h2(hex, 4)
    if (r < 0 || g < 0 || b < 0) return null
    return { r: r / 255, g: g / 255, b: b / 255, a: 1 }
  }
  if (hex.length === 8) {
    const r = h2(hex, 0)
    const g = h2(hex, 2)
    const b = h2(hex, 4)
    const a = h2(hex, 6)
    if (r < 0 || g < 0 || b < 0 || a < 0) return null
    return { r: r / 255, g: g / 255, b: b / 255, a: a / 255 }
  }
  return null
}

/** Parse one hex digit; return `-1` on non-hex. */
function h1(code: number): number {
  if (code >= 0x30 && code <= 0x39) return code - 0x30
  if (code >= 0x61 && code <= 0x66) return code - 0x61 + 10
  if (code >= 0x41 && code <= 0x46) return code - 0x41 + 10
  return -1
}

/** Parse two hex digits at `off`; return `-1` on non-hex. */
function h2(s: string, off: number): number {
  const hi = h1(s.charCodeAt(off))
  const lo = h1(s.charCodeAt(off + 1))
  if (hi < 0 || lo < 0) return -1
  return hi * 16 + lo
}

function parseRgbFn(s: string, hasAlpha: boolean): RGBA | null {
  const open = s.indexOf('(')
  const close = s.lastIndexOf(')')
  if (open < 0 || close < 0 || close <= open) return null
  const parts = s.slice(open + 1, close).split(',')
  if (hasAlpha ? parts.length !== 4 : parts.length !== 3) return null
  const r = Number(parts[0].trim())
  const g = Number(parts[1].trim())
  const b = Number(parts[2].trim())
  const a = hasAlpha ? Number(parts[3].trim()) : 1
  if (
    !Number.isFinite(r) ||
    !Number.isFinite(g) ||
    !Number.isFinite(b) ||
    !Number.isFinite(a)
  ) {
    return null
  }
  return { r: r / 255, g: g / 255, b: b / 255, a }
}

/** Test-only reset; not exported from the module barrel. */
export function _resetParseColorCacheForTests(): void {
  cache.clear()
  warned.clear()
}

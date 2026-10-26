/**
 * The colors rounds are drawn from. The list is large, so it is its own chunk
 * and loads on first use, while the splash is showing.
 */
import type { Rgb } from './contrast'

let loaded: Promise<readonly Rgb[]> | null = null

/** Decodes a string of six hex digits per color. */
export function unpackColors(packed: string): Rgb[] {
  const colors: Rgb[] = []
  for (let at = 0; at + 6 <= packed.length; at += 6) {
    const value = parseInt(packed.slice(at, at + 6), 16)
    colors.push([(value >> 16) & 255, (value >> 8) & 255, value & 255])
  }
  return colors
}

/** Every color a round can use. The first call starts the load. */
export function loadColors(): Promise<readonly Rgb[]> {
  loaded ??= import('./colorList').then((m) => unpackColors(m.PACKED_COLORS))
  return loaded
}

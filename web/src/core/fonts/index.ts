/**
 * Webfont readiness for the whole app.
 *
 * The engine rasterizes canvas text into a texture atlas and caches it keyed by
 * the font STRING — not by whether that font had loaded yet. So a `fillText`
 * issued before a webfont arrives bakes the fallback glyphs into the atlas and
 * keeps serving them until the entry is evicted. Layout is worse: text
 * measurements taken with fallback metrics are memoized too, so a late-arriving
 * face leaves text mispositioned, not merely mis-styled.
 *
 * The fix is a gate, not a repair: hold the mount until every shipped face has
 * settled, so the first frame already has the real glyphs. `watchFontChanges`
 * covers the failure path where a face misses the deadline and turns up later.
 */

import { clearFontMetricsCache, clearTextLayoutCaches } from '@src/stargazer'
import type { Engine } from '@src/stargazer'

/**
 * One spec per shipped (family, weight). Size is irrelevant to `fonts.load` —
 * it just has to parse as a font shorthand.
 *
 * Kept in step with the `@font-face` blocks in `styles/fonts.scss`; a face
 * missing from here simply is not waited for.
 */
export const BOOT_FONT_SPECS: readonly string[] = [
  '400 16px "Mozilla Text"',
  '500 16px "Mozilla Text"',
  '700 16px "Mozilla Text"',
  '600 16px "Mozilla Headline"',
  '700 16px "Mozilla Headline Extended"',
  // Variable faces: one spec is enough, the whole file downloads either way.
  '400 16px "Azeret Mono"',
  '400 16px "Geist"',
  '400 16px "HK Grotesk"',
  '500 16px "HK Grotesk"',
  '700 16px "HK Grotesk"',
  '400 16px "Bungee"',
  '400 16px "Raleway"',
  '400 16px "Sniglet"',
  '400 16px "Sorts Mill Goudy"',
  '400 16px "Bagnard"',
]

const canUseFontFaceSet = (): boolean =>
  typeof document !== 'undefined' && !!document.fonts

/**
 * Download every shipped face and wait for it to settle.
 *
 * A CSS `@font-face` is fetched lazily on first USE, so awaiting
 * `document.fonts.ready` on its own resolves immediately at boot and guarantees
 * nothing. The explicit `load()` calls are what start the fetches.
 *
 * Never rejects and never hangs past `timeoutMs`: a font that 404s or a network
 * that stalls must degrade to fallback glyphs, not brick the kiosk on a black
 * screen.
 */
export async function preloadFonts(timeoutMs = 2500): Promise<void> {
  if (!canUseFontFaceSet()) return

  const settle = (async () => {
    await Promise.all(
      BOOT_FONT_SPECS.map((spec) =>
        document.fonts.load(spec).catch((err: unknown) => {
          console.warn(`[fonts] failed to load ${spec}:`, err)
        }),
      ),
    )
    await document.fonts.ready
  })()

  let timer: ReturnType<typeof setTimeout> | undefined
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      console.warn(`[fonts] still loading after ${timeoutMs}ms, continuing`)
      resolve()
    }, timeoutMs)
  })

  try {
    await Promise.race([settle, deadline])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Call `onChange` when a font finishes loading after boot, so cached rasters
 * and measurements taken against a fallback face can be thrown away.
 *
 * Debounced, because `loadingdone` fires per batch and several can land in the
 * same tick. Self-disarming after `windowMs`, because the only interesting
 * arrivals are the ones that just missed the boot gate — past that, a
 * `document.fonts.add` from somewhere else should not be able to flush the
 * engine's caches mid-game.
 *
 * Returns an unsubscribe function.
 */
export function watchFontChanges(
  onChange: () => void,
  { debounceMs = 100, windowMs = 30_000 } = {},
): () => void {
  if (!canUseFontFaceSet()) return () => {}

  let debounce: ReturnType<typeof setTimeout> | undefined
  const handler = (): void => {
    clearTimeout(debounce)
    debounce = setTimeout(onChange, debounceMs)
  }
  document.fonts.addEventListener('loadingdone', handler)

  const disarm = setTimeout(() => {
    document.fonts.removeEventListener('loadingdone', handler)
  }, windowMs)

  return () => {
    clearTimeout(debounce)
    clearTimeout(disarm)
    document.fonts.removeEventListener('loadingdone', handler)
  }
}

/**
 * Re-shape an engine's canvas text if a webfont turns up after the boot gate
 * gave up on it.
 *
 * Clears the label atlas, the per-font metrics and the layout memo together —
 * all three are keyed by font string with no notion of load state, so leaving
 * any one of them stale keeps some text wrong. Metrics and layout matter most:
 * a stale raster only looks off, a stale measurement mislays the text around
 * it.
 *
 * Returns an unsubscribe function. Call on engine-ready.
 */
export function invalidateTextOnFontLoad(engine: Engine): () => void {
  return watchFontChanges(() => {
    clearFontMetricsCache()
    clearTextLayoutCaches()
    engine.invalidateText()
  })
}

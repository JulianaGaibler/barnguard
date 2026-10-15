// Reads `.lottie` archives. An archive is a zip with a manifest, one or more
// animations, optional themes, and the images and fonts the animations use.
// Version 1 keeps animations in `animations/` and images in `images/`. Version
// 2 uses `a/`, `t/`, `i/` and `f/`.

import { parseLottie } from '../model/parse'
import type { LottieAnimation } from '../model/types'
import { parseTheme, type LottieTheme } from './theme'
import { extractZipEntry, readZip, type ZipEntry } from './zip'

/** An animation listed in the manifest. */
export interface DotLottieAnimationEntry {
  id: string
  name?: string
  /** The theme the manifest applies to this animation first. */
  initialTheme?: string
  /** Themes that list this animation. */
  themes?: readonly string[]
}

/** Parsed `manifest.json`. */
export interface DotLottieManifest {
  version: string
  generator?: string
  animations: readonly DotLottieAnimationEntry[]
  themes: readonly string[]
  /** Id of the animation to show first. */
  initialAnimation?: string
}

/**
 * An opened `.lottie` archive.
 *
 * @example
 *   const file = await loadDotLottie('/emoji.lottie')
 *   const anim = file.getAnimation()
 *   const theme = file.getTheme('dark')
 *   const node = new LottieNode({ animation: anim })
 *   node.setTheme(theme)
 */
export interface DotLottie {
  readonly manifest: DotLottieManifest
  /** Ids of the animations in the archive. */
  readonly animationIds: readonly string[]
  /** Ids of the themes in the archive. */
  readonly themeIds: readonly string[]
  /**
   * Parse an animation. Without an id, the manifest's initial animation, or the
   * first one. Every call parses afresh, so two nodes can hold the same
   * animation with different themes and slots.
   */
  getAnimation(id?: string): LottieAnimation
  /** Parse a theme. Throws for an unknown id. */
  getTheme(id: string): LottieTheme
  /** Raw bytes of embedded images by their path inside the archive. */
  readonly images: ReadonlyMap<string, Uint8Array>
  /**
   * An embedded image as a `Blob`, by the file name an image layer uses, or
   * `null` when the archive has none. Pass it from a `LottieNode`'s
   * `assetResolver`.
   */
  getImage(path: string): Blob | null
  /** Raw bytes of embedded fonts by their path inside the archive. */
  readonly fonts: ReadonlyMap<string, Uint8Array>
  /** Release the parsed data. */
  dispose(): void
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function parseManifest(json: unknown): DotLottieManifest {
  if (typeof json !== 'object' || json === null) {
    throw new Error('parseDotLottie: manifest.json is not an object')
  }
  const m = json as Record<string, unknown>
  const animations: DotLottieAnimationEntry[] = []
  if (Array.isArray(m.animations)) {
    for (const a of m.animations) {
      if (typeof a !== 'object' || a === null) continue
      const e = a as Record<string, unknown>
      const id = str(e.id)
      if (!id) continue
      animations.push({
        id,
        name: str(e.name),
        initialTheme: str(e.initialTheme),
        themes: Array.isArray(e.themes)
          ? e.themes.filter((t): t is string => typeof t === 'string')
          : undefined,
      })
    }
  }
  const themes: string[] = []
  if (Array.isArray(m.themes)) {
    for (const t of m.themes) {
      const id = typeof t === 'string' ? t : str((t as { id?: unknown })?.id)
      if (id) themes.push(id)
    }
  }
  const initial = m.initial as { animation?: unknown } | undefined
  return {
    version: String(m.version ?? '1'),
    generator: str(m.generator),
    animations,
    themes,
    initialAnimation: str(initial?.animation) ?? str(m.activeAnimationId),
  }
}

/** Find an entry by its path, trying the version 1 and 2 folders. */
function find(
  entries: Map<string, ZipEntry>,
  folders: readonly string[],
  file: string,
): ZipEntry | undefined {
  for (const f of folders) {
    const e = entries.get(`${f}${file}`)
    if (e) return e
  }
  return undefined
}

/**
 * Open a `.lottie` archive from its bytes. Animations and themes are read
 * lazily as text and parsed on request. Images and fonts are extracted up
 * front.
 */
export async function parseDotLottie(bytes: Uint8Array): Promise<DotLottie> {
  const entries = readZip(bytes)
  const manifestEntry = entries.get('manifest.json')
  if (!manifestEntry) throw new Error('parseDotLottie: no manifest.json')
  const decoder = new TextDecoder()
  const manifest = parseManifest(
    JSON.parse(decoder.decode(await extractZipEntry(bytes, manifestEntry))),
  )
  const animationText = new Map<string, string>()
  for (const a of manifest.animations) {
    const e = find(entries, ['a/', 'animations/'], `${a.id}.json`)
    if (e)
      animationText.set(a.id, decoder.decode(await extractZipEntry(bytes, e)))
  }
  const themeText = new Map<string, string>()
  for (const id of manifest.themes) {
    const e = find(entries, ['t/', 'themes/'], `${id}.json`)
    if (e) themeText.set(id, decoder.decode(await extractZipEntry(bytes, e)))
  }
  const images = new Map<string, Uint8Array>()
  const fonts = new Map<string, Uint8Array>()
  for (const [name, entry] of entries) {
    if (name.startsWith('i/') || name.startsWith('images/')) {
      images.set(name, await extractZipEntry(bytes, entry))
    } else if (name.startsWith('f/') || name.startsWith('fonts/')) {
      fonts.set(name, await extractZipEntry(bytes, entry))
    }
  }
  const ids = [...animationText.keys()]
  return {
    manifest,
    animationIds: ids,
    themeIds: [...themeText.keys()],
    images,
    fonts,
    getAnimation(id) {
      const chosen = id ?? manifest.initialAnimation ?? ids[0]
      const text = chosen !== undefined ? animationText.get(chosen) : undefined
      if (text === undefined) {
        throw new Error(`DotLottie.getAnimation: no animation '${chosen}'`)
      }
      return parseLottie(text)
    },
    getImage(path) {
      const name = path.split('/').pop() ?? path
      for (const folder of ['i/', 'images/']) {
        const bytes = images.get(`${folder}${name}`)
        if (bytes) return new Blob([bytes as BlobPart])
      }
      return null
    },
    getTheme(id) {
      const text = themeText.get(id)
      if (text === undefined) {
        throw new Error(`DotLottie.getTheme: no theme '${id}'`)
      }
      return parseTheme(text)
    },
    dispose() {
      animationText.clear()
      themeText.clear()
      images.clear()
      fonts.clear()
    },
  }
}

/** How a loader fetches bytes. Defaults to `fetch`. */
export type LottieFetch = (url: string) => Promise<Response>

const cache = new Map<string, Promise<unknown>>()

/**
 * Fetch and parse Lottie JSON. Calls for the same URL share one fetch.
 *
 * @example
 *   const anim = await loadLottie('/spinner.json')
 */
export function loadLottie(
  url: string,
  opts: { fetch?: LottieFetch } = {},
): Promise<LottieAnimation> {
  const key = `json:${url}`
  let p = cache.get(key) as Promise<string> | undefined
  if (!p) {
    p = (opts.fetch ?? fetch)(url).then((r) => {
      if (!r.ok) throw new Error(`loadLottie: ${url} returned ${r.status}`)
      return r.text()
    })
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  // Each caller parses its own copy, so themes and slots stay per caller.
  return p.then((text) => parseLottie(text))
}

/** Fetch and open a `.lottie` archive. Calls for the same URL share one fetch. */
export function loadDotLottie(
  url: string,
  opts: { fetch?: LottieFetch } = {},
): Promise<DotLottie> {
  const key = `zip:${url}`
  let p = cache.get(key) as Promise<DotLottie> | undefined
  if (!p) {
    p = (opts.fetch ?? fetch)(url)
      .then((r) => {
        if (!r.ok) throw new Error(`loadDotLottie: ${url} returned ${r.status}`)
        return r.arrayBuffer()
      })
      .then((buf) => parseDotLottie(new Uint8Array(buf)))
    cache.set(key, p)
    p.catch(() => cache.delete(key))
  }
  return p
}

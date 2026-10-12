import {
  AssetLoader,
  getPathContours,
  parseSvgPaths,
  registerPathTessellation,
  tessellateContours,
  type SvgPathEntry,
  type SvgPathMap,
} from '@src/stargazer'
import eyeSvgRaw from '@src/displays/enterprise/assets/eye.svg?raw'
import impactFlashSvgRaw from '@src/displays/enterprise/assets/impact-flash.svg?raw'
import firefoxLogoUrl from '@src/displays/enterprise/assets/firefox-enterprise-symbol.png'
import { TUNING } from './data/tuning'

/**
 * Game assets that do not depend on which map is loaded. A map's own geometry
 * comes from its `MapDescriptor` (see `game/maps/`), so nothing here knows
 * about states or countries. Memoised via `AssetLoader`.
 */
export interface GameAssets {
  eye: SvgPathMap
  /**
   * The impact-flash sparkle, pre-centered on `(0, 0)` and pre-scaled so its
   * max dimension equals `TUNING.lossAnim.impactFlash.worldSize` at
   * `transform.scale = 1`. Instantiate a `Path2DNode` with this path and the
   * node's `transform.x/y` become the visual centre of the flash.
   */
  impactFlashPath: Path2D
  /**
   * Firefox Enterprise mark, decoded via `createImageBitmap` with
   * `imageOrientation: 'from-image'` so any orientation metadata is baked in.
   * Ready for `Gfx2D.drawImage`, painted inside the epicenter's apex disc.
   */
  firefoxLogo: HTMLImageElement | ImageBitmap
}

const assetLoader = new AssetLoader()

/** Load all game assets. Idempotent, repeat calls resolve to the same instance. */
export async function loadGameAssets(): Promise<GameAssets> {
  return assetLoader.load('booth-game-assets', async () => {
    const eye = parseSvgPaths(eyeSvgRaw, { tessellate: true })
    const impactFlashRaw = parseSvgPaths(impactFlashSvgRaw, {
      tessellate: true,
    })
    const impactFlashEntry = firstPathValue(impactFlashRaw)
    if (!impactFlashEntry) {
      throw new Error('loadGameAssets: impact-flash SVG contains no <path>')
    }
    const impactFlashPath = buildImpactFlashPath(impactFlashEntry)
    const firefoxLogo = await loadImage(firefoxLogoUrl)

    return {
      eye,
      impactFlashPath,
      firefoxLogo,
    }
  })
}

/**
 * Fetch a bitmap. `imageOrientation: 'from-image'` bakes EXIF orientation into
 * the decoded pixels so downstream drawing sees a plain grid.
 */
async function loadImage(url: string): Promise<HTMLImageElement | ImageBitmap> {
  if (
    typeof createImageBitmap !== 'undefined' &&
    typeof fetch !== 'undefined'
  ) {
    const res = await fetch(url)
    if (!res.ok) {
      throw new Error(`loadGameAssets: failed to fetch ${url}: ${res.status}`)
    }
    const blob = await res.blob()
    return createImageBitmap(blob, { imageOrientation: 'from-image' })
  }
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.decoding = 'async'
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new Error(`loadGameAssets: failed to load image ${url}`))
    img.src = url
  })
}

/**
 * Rebuild the impact-flash into a `Path2D` centred on `(0, 0)` and scaled so
 * `max(w, h)` equals `TUNING.lossAnim.impactFlash.worldSize`. Uses
 * `addPath(source, matrix)`, no re-parsing. Also transforms the source's
 * tessellated contours and registers them under the new Path2D so GPU
 * `fillPath2D` picks them up (registrations are keyed by instance).
 */
function buildImpactFlashPath(entry: SvgPathEntry): Path2D {
  const b = entry.bounds
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const s = TUNING.lossAnim.impactFlash.worldSize / Math.max(b.width, b.height)
  const ex = -cx * s
  const ey = -cy * s
  const out = new Path2D()
  out.addPath(entry.path, { a: s, b: 0, c: 0, d: s, e: ex, f: ey })
  const srcContours = getPathContours(entry.path)
  if (srcContours) {
    const transformed = srcContours.map((c) => {
      const t = new Float32Array(c.length)
      for (let i = 0; i < c.length; i += 2) {
        t[i] = s * c[i] + ex
        t[i + 1] = s * c[i + 1] + ey
      }
      return t
    })
    registerPathTessellation(out, tessellateContours(transformed), transformed)
  }
  return out
}

function firstPathValue(map: SvgPathMap): SvgPathEntry | null {
  for (const entry of map.paths.values()) return entry
  return null
}

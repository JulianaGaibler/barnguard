import {
  AssetLoader,
  buildBitmapMask,
  parseSvgPaths,
  type BitmapMask,
  type SvgPathEntry,
  type SvgPathMap,
  type Vec2,
} from '@src/stargazer'
import { tessellateContours } from '@src/stargazer/assets/SvgPathContours'
import {
  getPathContours,
  registerPathTessellation,
} from '@src/stargazer/render/gfx/PathTessellationRegistry'
import statesSvgRaw from '@src/assets/de-states.svg?raw'
import outlineSvgRaw from '@src/assets/de-outline.svg?raw'
import citiesSvgRaw from '@src/assets/de-cities.svg?raw'
import eyeSvgRaw from '@src/assets/eye.svg?raw'
import impactFlashSvgRaw from '@src/assets/impact-flash.svg?raw'
import firefoxLogoUrl from '@src/assets/firefox-enterprise-symbol.png'
import { CITY_ID_TO_STATE_ID, STATES } from './data/states'
import { TUNING } from './data/tuning'

/**
 * All game assets. SVGs parse to `Path2D`, outline builds a `BitmapMask` for
 * O(1) inside-Germany checks. Capital positions come from `de-cities.svg`
 * (circle AABB centre) and stamp `STATES.capitalWorld`. Memoised via
 * `AssetLoader`.
 */
export interface GameAssets {
  states: SvgPathMap
  outline: SvgPathMap
  cities: SvgPathMap
  eye: SvgPathMap
  mask: BitmapMask
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
   * Ready for `Gfx2D.drawImage`; painted inside the epicenter's apex disc.
   */
  firefoxLogo: HTMLImageElement | ImageBitmap
}

const assetLoader = new AssetLoader()

/** Load all game assets. Idempotent, repeat calls resolve to the same instance. */
export async function loadGameAssets(): Promise<GameAssets> {
  return assetLoader.load('booth-game-assets', async () => {
    // ~94 paths total, tessellating at load is cheap (~20-50 ms). GPU
    // renders the map live each frame so no bake-and-reproject.
    const states = parseSvgPaths(statesSvgRaw, { tessellate: true })
    const outline = parseSvgPaths(outlineSvgRaw, { tessellate: true })
    const cities = parseSvgPaths(citiesSvgRaw, { tessellate: true })
    const eye = parseSvgPaths(eyeSvgRaw, { tessellate: true })
    const impactFlashRaw = parseSvgPaths(impactFlashSvgRaw, {
      tessellate: true,
    })

    // The outline SVG ships as many small unnamed `<path>` fragments
    // (mainland + every visible island). Merge them into ONE `Path2D` so
    // the map draws + the bitmap mask covers the whole country in a single
    // pass. Without this we'd render only the first fragment.
    const outlineMerged = mergeAllPaths(outline)
    if (!outlineMerged) {
      throw new Error('loadGameAssets: outline SVG contains no <path>')
    }
    const impactFlashEntry = firstPathValue(impactFlashRaw)
    if (!impactFlashEntry) {
      throw new Error('loadGameAssets: impact-flash SVG contains no <path>')
    }

    // Replace the outline map's per-fragment entries with the merged one
    // under a canonical key so downstream code can look up "the outline"
    // without knowing about the fragmentation.
    const outlinePaths = new Map<string, SvgPathEntry>()
    outlinePaths.set('outline', outlineMerged)
    const outlineOut: SvgPathMap = {
      viewBox: outline.viewBox,
      paths: outlinePaths,
    }

    const mask = await buildBitmapMask({
      path: outlineMerged.path,
      worldRect: outline.viewBox,
      resolution: 1024,
    })

    const impactFlashPath = buildImpactFlashPath(impactFlashEntry)

    const firefoxLogo = await loadImage(firefoxLogoUrl)

    // Fill in per-state derived geometry (state-shape center + upper/lower
    // half) from the parsed state paths. Idempotent, the STATES array is
    // a module singleton and reload paths simply rewrite the same fields
    // with the same numbers.
    fillStateGeometry(states)
    fillCapitals(cities)

    return {
      states,
      outline: outlineOut,
      cities,
      eye,
      mask,
      impactFlashPath,
      firefoxLogo,
    }
  })
}

/**
 * Fetch a bitmap. `imageOrientation: 'from-image'` bakes EXIF orientation
 * into the decoded pixels so downstream drawing sees a plain grid.
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
 * `addPath(source, matrix)`, no re-parsing.
 */
function buildImpactFlashPath(entry: SvgPathEntry): Path2D {
  const b = entry.bounds
  const cx = b.x + b.width / 2
  const cy = b.y + b.height / 2
  const s = TUNING.lossAnim.impactFlash.worldSize / Math.max(b.width, b.height)
  const out = new Path2D()
  out.addPath(entry.path, {
    a: s,
    b: 0,
    c: 0,
    d: s,
    e: -cx * s,
    f: -cy * s,
  })
  return out
}

/**
 * Populate `STATES[i].stateCenter` and `.half` from the parsed state SVG.
 * `capitalWorld` is filled by `fillCapitals` from `de-cities.svg`.
 */
function fillStateGeometry(states: SvgPathMap): void {
  const viewH = states.viewBox.height
  const halfY = viewH / 2

  for (const info of STATES) {
    const stateEntry = states.paths.get(info.id)
    if (!stateEntry) {
      console.warn(`[assets] de-states.svg missing path for state ${info.id}`)
      continue
    }
    const b = stateEntry.bounds
    const center: Vec2 = {
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
    }
    info.stateCenter = center
    info.half = center.y < halfY ? 'upper' : 'lower'
  }
}

/**
 * Fill `STATES[i].capitalWorld` from circle-path AABB centres in
 * `de-cities.svg`. `CITY_ID_TO_STATE_ID` maps city ids to `StateId`.
 */
function fillCapitals(cities: SvgPathMap): void {
  for (const [cityId, stateId] of Object.entries(CITY_ID_TO_STATE_ID)) {
    const entry = cities.paths.get(cityId)
    if (!entry) {
      console.warn(`[assets] de-cities.svg missing path for city "${cityId}"`)
      continue
    }
    const info = STATES.find((s) => s.id === stateId)
    if (!info) continue
    const b = entry.bounds
    info.capitalWorld = {
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
    }
  }
}

function firstPathValue(map: SvgPathMap): SvgPathEntry | null {
  for (const entry of map.paths.values()) return entry
  return null
}

/**
 * Merge every path in `map` into a single `Path2D` + union AABB. Used for the
 * country outline, which ships as many small fragments (mainland + islands)
 * that should render + rasterise as one shape.
 */
function mergeAllPaths(map: SvgPathMap): SvgPathEntry | null {
  const merged = new Path2D()
  let bounds: SvgPathEntry['bounds'] | null = null
  const mergedContours: Float32Array[] = []
  for (const entry of map.paths.values()) {
    merged.addPath(entry.path)
    // Also merge tessellation data so the merged Path2D is renderable
    // under GPU. Each source `entry.path` was tessellated by parseSvgPaths;
    // we pool their contours + retriangulate the union.
    const partContours = getPathContours(entry.path)
    if (partContours) {
      for (const c of partContours) mergedContours.push(c)
    }
    if (!bounds) {
      bounds = { ...entry.bounds }
    } else {
      const x = Math.min(bounds.x, entry.bounds.x)
      const y = Math.min(bounds.y, entry.bounds.y)
      const right = Math.max(
        bounds.x + bounds.width,
        entry.bounds.x + entry.bounds.width,
      )
      const bottom = Math.max(
        bounds.y + bounds.height,
        entry.bounds.y + entry.bounds.height,
      )
      bounds = { x, y, width: right - x, height: bottom - y }
    }
  }
  if (!bounds) return null
  if (mergedContours.length > 0) {
    const triangles = tessellateContours(mergedContours)
    registerPathTessellation(merged, triangles, mergedContours)
  }
  return { path: merged, bounds }
}

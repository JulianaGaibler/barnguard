// Rasterises the ten designed icon SVGs to canvases once, so the card face and
// resource bars can draw them with `gfx.drawImage`. The engine keys a drawImage
// texture by source-object identity, so one canvas per icon — held for the
// engine's lifetime by a module-scope `AssetLoader` — means ten textures total,
// uploaded once. A session-scoped loader would leak a texture set per match,
// since `#textureBySource` never evicts.
//
// Import-safe: nothing touches the DOM until `loadIcons` runs, and a missing
// rasteriser (headless tests, or a stripped 2D context) yields a blank sized
// canvas instead of throwing, so `startGame` never rejects on assets.
import { AssetLoader } from '@src/stargazer'
import type { Floor, Group } from '../game/rules/deck'
import approval from '../assets/icons/approval.svg?raw'
import budget from '../assets/icons/budget.svg?raw'
import floorIc from '../assets/icons/floor-ic.svg?raw'
import floorManagement from '../assets/icons/floor-management.svg?raw'
import groupLeadership from '../assets/icons/group-leadership.svg?raw'
import groupPeople from '../assets/icons/group-people.svg?raw'
import groupResearch from '../assets/icons/group-research.svg?raw'
import groupProduct from '../assets/icons/group-product.svg?raw'
import groupEngineering from '../assets/icons/group-engineering.svg?raw'
import groupDesign from '../assets/icons/group-design.svg?raw'

export type IconId = 'approval' | 'budget' | `floor-${Floor}` | `group-${Group}`

export type IconSet = Record<IconId, HTMLCanvasElement>

const SVG: Record<IconId, string> = {
  approval,
  budget,
  'floor-ic': floorIc,
  'floor-management': floorManagement,
  'group-leadership': groupLeadership,
  'group-people': groupPeople,
  'group-research': groupResearch,
  'group-product': groupProduct,
  'group-engineering': groupEngineering,
  'group-design': groupDesign,
}

/**
 * Rasterise each icon at this multiple of its SVG size so it stays crisp when
 * scaled up on a card.
 */
const RASTER_SCALE = 4

const loader = new AssetLoader()
let cached: IconSet | null = null

/** Parse the `w`/`h` from an SVG's `viewBox`, falling back to a square. */
export function viewBoxSize(svg: string): { w: number; h: number } {
  const m = /viewBox="[\d.-]+\s+[\d.-]+\s+([\d.]+)\s+([\d.]+)"/.exec(svg)
  if (m) return { w: Number(m[1]), h: Number(m[2]) }
  return { w: 64, h: 64 }
}

async function rasterize(svg: string): Promise<HTMLCanvasElement> {
  const { w, h } = viewBoxSize(svg)
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(w * RASTER_SCALE))
  canvas.height = Math.max(1, Math.round(h * RASTER_SCALE))
  const ctx = canvas.getContext('2d')
  // No 2D context or no bitmap decoder (headless): leave a blank sized canvas.
  if (!ctx || typeof createImageBitmap !== 'function') return canvas
  try {
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const bitmap = await createImageBitmap(blob)
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()
  } catch {
    // Rasterisation unavailable; the blank canvas keeps callers safe.
  }
  return canvas
}

/** Rasterise every icon. Idempotent, repeat calls resolve to the same canvases. */
export async function loadIcons(): Promise<IconSet> {
  const set = await loader.load('office-overtime-icons', async () => {
    const ids = Object.keys(SVG) as IconId[]
    const canvases = await Promise.all(ids.map((id) => rasterize(SVG[id])))
    const out = {} as IconSet
    ids.forEach((id, i) => (out[id] = canvases[i]!))
    return out
  })
  cached = set
  return set
}

/** The loaded icons, or `null` before `loadIcons` has resolved. */
export function icons(): IconSet | null {
  return cached
}

export function groupBadge(set: IconSet, group: Group): HTMLCanvasElement {
  return set[`group-${group}`]
}

export function floorMark(set: IconSet, floor: Floor): HTMLCanvasElement {
  return set[`floor-${floor}`]
}

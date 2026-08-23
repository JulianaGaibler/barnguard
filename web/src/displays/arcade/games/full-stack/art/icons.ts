// The designed icons, rasterised once for `gfx.drawImage`.
//
// The engine keys a drawImage texture by source-object identity, so one canvas
// per icon, held for the engine's lifetime by a module-scope `AssetLoader`,
// means one texture per icon uploaded once. A session-scoped loader would leak
// a texture set per match, since `#textureBySource` never evicts.
//
// Floor marks come in two weights. The 25% black pair is the watermark on the
// art panel. Inline in a sentence that reads far lighter than the text around
// it, so the ink pair carries the same shapes at full strength.
//
// `RASTER_SCALE` oversamples because a card grows and shrinks with the window:
// a badge draws near 37 device px at rest and 28 mid-drag, and far larger on a
// big display. Per-source textures carry a mip chain, so the minified end stays
// crisp and the extra resolution is free.

import { AssetLoader, rasterizeSvg, type Gfx2D } from '@src/stargazer'
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
import groupEqual from '../assets/icons/group-equal.svg?raw'
import groupNotEqual from '../assets/icons/group-not-equal.svg?raw'
import floorIcInk from '../assets/icons/floor-ic-ink.svg?raw'
import floorManagementInk from '../assets/icons/floor-management-ink.svg?raw'
import positionHorizontal from '../assets/icons/position-horizontal.svg?raw'
import positionVertical from '../assets/icons/position-vertical.svg?raw'
import positionBoth from '../assets/icons/position-both.svg?raw'
import areaTopRow from '../assets/icons/area-top-row.svg?raw'
import areaMiddleRow from '../assets/icons/area-middle-row.svg?raw'
import areaBottomRow from '../assets/icons/area-bottom-row.svg?raw'
import areaLeftColumn from '../assets/icons/area-left-column.svg?raw'
import areaMiddleColumn from '../assets/icons/area-middle-column.svg?raw'
import areaRightColumn from '../assets/icons/area-right-column.svg?raw'
import areaCorner from '../assets/icons/area-corner.svg?raw'
import areaEdgeCenter from '../assets/icons/area-edge-center.svg?raw'
import leftoverBudget from '../assets/icons/leftover-budget.svg?raw'
import aiSeat from '../assets/icons/ai-seat.svg?raw'
import gridEmpty from '../assets/icons/grid-empty.svg?raw'
import gridFull from '../assets/icons/grid-full.svg?raw'
import groupMissing from '../assets/icons/group-missing.svg?raw'
import help from '../assets/icons/help.svg?raw'
import helpOn from '../assets/icons/help-on.svg?raw'
import elevator from '../assets/icons/elevator.svg?raw'

export type IconId =
  | 'approval'
  | 'budget'
  | 'leftover-budget'
  | 'ai-seat'
  | 'grid-empty'
  | 'grid-full'
  | 'group-missing'
  | 'help'
  | 'help-on'
  | 'elevator'
  | 'equal'
  | 'not-equal'
  | 'position-horizontal'
  | 'position-vertical'
  | 'position-both'
  | 'area-top-row'
  | 'area-middle-row'
  | 'area-bottom-row'
  | 'area-left-column'
  | 'area-middle-column'
  | 'area-right-column'
  | 'area-corner'
  | 'area-edge-center'
  | `floor-${Floor}`
  | `floor-${Floor}-ink`
  | `group-${Group}`

export type IconSet = Record<IconId, HTMLCanvasElement>

const SVG: Record<IconId, string> = {
  approval,
  budget,
  'leftover-budget': leftoverBudget,
  'ai-seat': aiSeat,
  'grid-empty': gridEmpty,
  'grid-full': gridFull,
  'group-missing': groupMissing,
  help,
  'help-on': helpOn,
  elevator,
  'floor-ic': floorIc,
  'floor-management': floorManagement,
  'group-leadership': groupLeadership,
  'group-people': groupPeople,
  'group-research': groupResearch,
  'group-product': groupProduct,
  'group-engineering': groupEngineering,
  'group-design': groupDesign,
  equal: groupEqual,
  'not-equal': groupNotEqual,
  'floor-ic-ink': floorIcInk,
  'floor-management-ink': floorManagementInk,
  'position-horizontal': positionHorizontal,
  'position-vertical': positionVertical,
  'position-both': positionBoth,
  'area-top-row': areaTopRow,
  'area-middle-row': areaMiddleRow,
  'area-bottom-row': areaBottomRow,
  'area-left-column': areaLeftColumn,
  'area-middle-column': areaMiddleColumn,
  'area-right-column': areaRightColumn,
  'area-corner': areaCorner,
  'area-edge-center': areaEdgeCenter,
}

/** Multiple of each SVG's own size to rasterise at. */
const RASTER_SCALE = 4

const loader = new AssetLoader()
let cached: IconSet | null = null

/** Rasterise every icon. Idempotent, repeat calls resolve to the same canvases. */
export async function loadIcons(): Promise<IconSet> {
  const set = await loader.load('full-stack-icons', async () => {
    const ids = Object.keys(SVG) as IconId[]
    const canvases = await Promise.all(
      ids.map((id) => rasterizeSvg(SVG[id], { scale: RASTER_SCALE })),
    )
    const out = {} as IconSet
    ids.forEach((id, i) => (out[id] = canvases[i]!))
    return out
  })
  cached = set
  return set
}

/**
 * The source of one icon, for a renderer that takes SVG rather than a canvas.
 *
 * The DOM overlays sit outside the canvas and cannot draw from the raster set,
 * so they inline the same artwork the board rasterises.
 */
export const iconSvg = (id: IconId): string => SVG[id]

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

/**
 * Draw an icon at `height`, taking its width from the canvas so each keeps its
 * own proportions: the approval slip is 28x40 and the budget note 42x26, so one
 * shared aspect would squash whichever it was not chosen for. Returns the width
 * drawn, so callers can advance a row.
 */
export function drawIcon(
  gfx: { drawImage: Gfx2D['drawImage'] },
  icon: HTMLCanvasElement,
  x: number,
  y: number,
  height: number,
): number {
  const width = iconWidth(icon, height)
  gfx.drawImage(icon, x, y, width, height)
  return width
}

/** The width an icon occupies when drawn at `height`. */
export function iconWidth(icon: HTMLCanvasElement, height: number): number {
  const ratio = icon.height > 0 ? icon.width / icon.height : 1
  return height * ratio
}

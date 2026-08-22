// Where everything sits.
//
// The row holds nine equal cards in three groups of three — org, shortlists,
// org — with a wide gap between the groups. A card width `W` binds on height at
// 16:9, so the spare horizontal width is handed to the two region gaps, which is
// exactly the separation the design asks for. The centre pair of shortlists is
// vertically centred against the org grids, with the controls below.
//
// The intra-region card gap is a fraction of `W`, not of the view, so an org
// cell and a shortlist card recover the same width from an equal-width region:
// `regionWidth = W * (3 + 2 * gapRatio)`, and every reader inverts that.

import type { Rect } from '@src/stargazer'
import { LAYOUT } from './tuning'

export interface TableRects {
  /** Each player's 3x3 org area. */
  org: [Rect, Rect]
  /** Approvals and budget, under each org. */
  resources: [Rect, Rect]
  /** The two shortlists, Management above IC. */
  shortlist: [Rect, Rect]
  /** The caption strip above each shortlist. */
  captions: [Rect, Rect]
  /**
   * The control stack (switch floor / redeal / replace with AI), below the
   * shortlists.
   */
  controls: Rect
}

/** How much wider a region is than its three cards, from the intra-card gap. */
const REGION_SPAN = 3 + 2 * LAYOUT.cardGapRatio

const rect = (x: number, y: number, width: number, height: number): Rect => ({
  x,
  y,
  width,
  height,
})

/** Measure the table into `view` and return the world rect of every region. */
export function computeTable(view: Rect): TableRects {
  const small = Math.min(view.width, view.height)
  const pad = small * LAYOUT.padFrac
  const regionGapMin = small * LAYOUT.regionGapMinFrac
  const resourceGap = small * LAYOUT.resourceGapFrac
  const resourceBar = view.height * LAYOUT.resourceBarFrac
  const caption = view.height * LAYOUT.captionFrac
  const controls = view.height * LAYOUT.controlFrac

  const availW = view.width - 2 * pad
  const usableTop = view.y + view.height * LAYOUT.topReserveFrac
  const usableH = view.height * (1 - 2 * LAYOUT.topReserveFrac)

  // Card width, whichever of the two bounds is tighter.
  const wFromWidth = (availW - 2 * regionGapMin) / (3 * REGION_SPAN)
  const wFromHeight =
    (usableH - resourceGap - resourceBar) /
    (3 * LAYOUT.cardAspect + 2 * LAYOUT.cardGapRatio)
  const w = Math.max(0, Math.min(wFromWidth, wFromHeight))

  const cardH = w * LAYOUT.cardAspect
  const cardGap = w * LAYOUT.cardGapRatio
  const regionW = w * REGION_SPAN
  const orgH = 3 * cardH + 2 * cardGap
  // Spare horizontal space becomes the two region gaps.
  const regionGap = Math.max(regionGapMin, (availW - 3 * regionW) / 2)

  const colX = (i: 0 | 1 | 2): number =>
    view.x + pad + i * (regionW + regionGap)
  const orgY = usableTop

  const org: [Rect, Rect] = [
    rect(colX(0), orgY, regionW, orgH),
    rect(colX(2), orgY, regionW, orgH),
  ]
  const resourceY = orgY + orgH + resourceGap
  const resources: [Rect, Rect] = [
    rect(colX(0), resourceY, regionW, resourceBar),
    rect(colX(2), resourceY, regionW, resourceBar),
  ]

  // Centre column: caption + Management row, caption + IC row, then controls,
  // centred vertically against the org grids.
  const rowGap = cardGap * 2
  const stackH = 2 * (caption + cardH) + rowGap + controls + rowGap
  const cx = colX(1)
  let y = orgY + Math.max(0, (orgH - stackH) / 2)
  const captions: [Rect, Rect] = [
    rect(cx, y, regionW, caption),
    rect(0, 0, 0, 0),
  ]
  y += caption
  const shortlist: [Rect, Rect] = [
    rect(cx, y, regionW, cardH),
    rect(0, 0, 0, 0),
  ]
  y += cardH + rowGap
  captions[1] = rect(cx, y, regionW, caption)
  y += caption
  shortlist[1] = rect(cx, y, regionW, cardH)
  y += cardH + rowGap
  const controlsRect = rect(cx, y, regionW, controls)

  return { org, resources, shortlist, captions, controls: controlsRect }
}

/** Geometry of one 3x3 org: cell size and the origin of cell (0, 0). */
export interface OrgGeom {
  cell: number
  gap: number
  originX: number
  originY: number
}

/**
 * Fit a 3x3 grid of portrait cards inside `rect`, matching the shortlist card
 * width.
 */
export function orgGeom(r: Rect): OrgGeom {
  const cell = r.width / REGION_SPAN
  const gap = cell * LAYOUT.cardGapRatio
  const usedH = cell * LAYOUT.cardAspect * 3 + gap * 2
  return {
    cell,
    gap,
    originX: r.x,
    originY: r.y + Math.max(0, (r.height - usedH) / 2),
  }
}

/** World rect of one org cell. */
export function cellRect(geom: OrgGeom, row: number, col: number): Rect {
  return {
    x: geom.originX + col * (geom.cell + geom.gap),
    y: geom.originY + row * (geom.cell * LAYOUT.cardAspect + geom.gap),
    width: geom.cell,
    height: geom.cell * LAYOUT.cardAspect,
  }
}

/**
 * Rect of one cell in a `cols` x `rows` grid fitted (centred) inside `region`.
 *
 * The org shows a 3x3 window at rest but opens to as much as 4x4 during a drag,
 * and the cards scale down to keep the same region. This fits whatever window
 * is asked for, so an org cell is the same width as a shortlist card only while
 * the window is 3 wide, which is the intended "nine equal at rest" behaviour.
 */
export function windowCellRect(
  region: Rect,
  cols: number,
  rows: number,
  row: number,
  col: number,
): Rect {
  const g = LAYOUT.cardGapRatio
  const a = LAYOUT.cardAspect
  const cellByW = region.width / (cols + (cols - 1) * g)
  const cellByH = region.height / (rows * a + (rows - 1) * g)
  const cell = Math.max(0, Math.min(cellByW, cellByH))
  const gap = cell * g
  const gridW = cols * cell + (cols - 1) * gap
  const gridH = rows * cell * a + (rows - 1) * gap
  const ox = region.x + (region.width - gridW) / 2
  const oy = region.y + (region.height - gridH) / 2
  return {
    x: ox + col * (cell + gap),
    y: oy + row * (cell * a + gap),
    width: cell,
    height: cell * a,
  }
}

/** Fit three candidate cards in a row inside `rect`, each the org cell width. */
export function shortlistSlots(r: Rect): Rect[] {
  const cardW = r.width / REGION_SPAN
  const gap = cardW * LAYOUT.cardGapRatio
  const h = Math.min(r.height, cardW * LAYOUT.cardAspect)
  const cardWFit = h / LAYOUT.cardAspect
  const usedW = cardWFit * 3 + gap * 2
  const x0 = r.x + (r.width - usedW) / 2
  const y0 = r.y + (r.height - h) / 2
  return [0, 1, 2].map((i) => ({
    x: x0 + i * (cardWFit + gap),
    y: y0,
    width: cardWFit,
    height: h,
  }))
}

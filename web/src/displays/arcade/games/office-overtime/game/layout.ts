// Where everything sits.
//
// A headless layout tree, run the way jezzball does it: measure and arrange
// against the game region's visible rect, then read the resulting world rects
// back out of the `LayoutBuilder` callbacks. No `LayoutRoot` is added to the
// scene, because one would default its bounds to the camera's visible world
// rect and install a second resize listener that fights `session.resize`.
//
// `crossAxisAlign: 'stretch'` is load-bearing at every level. `Flex` defaults
// to `'start'`, which offers children a zero minimum on the cross axis; a
// `LayoutBuilder` then measures to that minimum and the whole tree arranges at
// zero size. It only warns when the maximum is infinite, so with a finite one
// it collapses silently. `Expanded` fixes the main axis only.

import {
  AspectRatio,
  BoxConstraints,
  Column,
  Expanded,
  LayoutBuilder,
  Padding,
  Row,
  SizedBox,
  edgeInsets,
  type MeasurableNode,
  type Rect,
} from '@src/stargazer'
import { LAYOUT } from './tuning'

export interface TableRects {
  /** Each player's 3x3 org area. */
  org: [Rect, Rect]
  /** Approvals and budget, under each org. */
  resources: [Rect, Rect]
  /** The two shortlists, Management above IC. */
  shortlist: [Rect, Rect]
  /** Between the shortlists, for the floor marker. */
  marker: Rect
}

const emptyRect = (): Rect => ({ x: 0, y: 0, width: 0, height: 0 })

const copy = (into: Rect, from: Readonly<Rect>): void => {
  into.x = from.x
  into.y = from.y
  into.width = from.width
  into.height = from.height
}

/**
 * Measure the table into `view` and return the world rect of every region.
 *
 * The centre column is wider than the two orgs because the candidates are what
 * the players are reading. A header band is reserved above it: the launcher's
 * pull-down gesture arms in the top slice of the viewport, and nothing
 * draggable may start there.
 */
export function computeTable(view: Rect): TableRects {
  const rects: TableRects = {
    org: [emptyRect(), emptyRect()],
    resources: [emptyRect(), emptyRect()],
    shortlist: [emptyRect(), emptyRect()],
    marker: emptyRect(),
  }

  const gap = Math.min(view.width, view.height) * LAYOUT.gapFrac
  const pad = Math.min(view.width, view.height) * LAYOUT.padFrac

  const side = (index: 0 | 1): MeasurableNode =>
    new Expanded({
      child: new Column({
        crossAxisAlign: 'stretch',
        children: [
          new Expanded({
            child: new AspectRatio({
              ratio: LAYOUT.orgAspect,
              child: new LayoutBuilder({
                onLayout: (r) => copy(rects.org[index], r),
              }),
            }),
          }),
          new SizedBox({ width: gap, height: gap * 0.5 }),
          new SizedBox({
            width: 0,
            height: LAYOUT.resourceBarHeight,
            child: new LayoutBuilder({
              onLayout: (r) => copy(rects.resources[index], r),
            }),
          }),
        ],
      }),
    })

  const middle = new Expanded({
    flex: LAYOUT.centerFlex,
    child: new Column({
      crossAxisAlign: 'stretch',
      children: [
        // Reserved, deliberately empty: no draggable card may begin inside the
        // launcher pull-down zone at the top of the screen.
        new SizedBox({ width: 0, height: LAYOUT.headerHeight }),
        new Expanded({
          child: new LayoutBuilder({
            onLayout: (r) => copy(rects.shortlist[0], r),
          }),
        }),
        new SizedBox({
          width: 0,
          height: LAYOUT.markerHeight,
          child: new LayoutBuilder({
            onLayout: (r) => copy(rects.marker, r),
          }),
        }),
        new Expanded({
          child: new LayoutBuilder({
            onLayout: (r) => copy(rects.shortlist[1], r),
          }),
        }),
      ],
    }),
  })

  const content = new Padding({
    insets: edgeInsets(pad),
    child: new Row({
      gap,
      crossAxisAlign: 'stretch',
      children: [side(0), middle, side(1)],
    }),
  })

  content.measure(BoxConstraints.tight(view.width, view.height))
  content.arrange(view.x, view.y, view.width, view.height)
  return rects
}

/** Geometry of one 3x3 org: cell size and the origin of cell (0, 0). */
export interface OrgGeom {
  cell: number
  gap: number
  originX: number
  originY: number
}

/** Fit a 3x3 grid of portrait cards centred inside `rect`. */
export function orgGeom(rect: Rect): OrgGeom {
  const gap = Math.min(rect.width, rect.height) * LAYOUT.cellGapFrac
  const cellW = (rect.width - gap * 2) / 3
  const cellH = (rect.height - gap * 2) / 3
  // Cards are portrait, so the height budget is what binds.
  const cell = Math.max(0, Math.min(cellW, cellH / LAYOUT.cardAspect))
  const usedW = cell * 3 + gap * 2
  const usedH = cell * LAYOUT.cardAspect * 3 + gap * 2
  return {
    cell,
    gap,
    originX: rect.x + (rect.width - usedW) / 2,
    originY: rect.y + (rect.height - usedH) / 2,
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

/** Fit three candidate cards in a row inside `rect`. */
export function shortlistSlots(rect: Rect): Rect[] {
  const gap = rect.width * LAYOUT.slotGapFrac
  const w = Math.max(0, (rect.width - gap * 2) / 3)
  const h = Math.min(rect.height, w * LAYOUT.cardAspect)
  const cardW = h / LAYOUT.cardAspect
  const usedW = cardW * 3 + gap * 2
  const x0 = rect.x + (rect.width - usedW) / 2
  const y0 = rect.y + (rect.height - h) / 2
  return [0, 1, 2].map((i) => ({
    x: x0 + i * (cardW + gap),
    y: y0,
    width: cardW,
    height: h,
  }))
}

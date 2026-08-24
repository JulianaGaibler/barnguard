// The symbols a card's rules read in.
//
// A glyph is an id, an aspect and a way to paint itself. The engine's rich text
// takes inline boxes that carry a name and a size and hands the name back on
// the laid-out run, so encoding the whole glyph into that name is what lets a
// paragraph wrap around symbols with no side table between layout and draw. It
// also keeps the wrap cache correct without effort, since two different glyphs
// can never share a key.
//
// Aspects come from the design sizes below, never from a canvas. Layout runs
// before the rasteriser resolves, and a card whose text reflows once the icons
// arrive is worse than one that leaves the holes for a frame.

import type { Gfx2D, InlineBox } from '@src/stargazer'
import { drawIcon, iconSvg, icons, type IconId } from './icons'
import type { Area, Floor, Group, Region } from '../game/rules/deck'
import { ALL_GROUPS } from '../game/rules/deck'

/** A symbol standing in for a word in a card's rules. */
export type Glyph = SimpleGlyph | RegionGlyph

/** A glyph that is one piece of artwork. */
export type SimpleGlyph =
  | { g: 'approval' }
  | { g: 'budget' }
  /**
   * A seat that stores leftover budget at the end of the game.
   *
   * A bag rather than a note, because it stands for the store and not for the
   * money in it. A card's rules read "per 1k[note] in [bag]", and the same bag
   * is what a rule counting budget lines counts.
   */
  | { g: 'bag' }
  /** A seat taken face down, which fills a slot and scores nothing. */
  | { g: 'aiSeat' }
  /** Hiring this card sends the floor marker to the other floor. */
  | { g: 'elevator' }
  | { g: 'emptySeat' }
  | { g: 'filledSeat' }
  | { g: 'group'; group: Group }
  /** A department the org has none of. */
  | { g: 'missingGroup' }
  | { g: 'floor'; floor: Floor }
  /** All of one department, as against `notEqual`. */
  | { g: 'equal' }
  /** Departments that differ from each other. */
  | { g: 'notEqual' }
  /** The org with the cells a placement bonus wants pinned. */
  | { g: 'area'; area: Area }

/**
 * Which cells around this card a rule counts over, paired with whatever the
 * rule counts. The marker is drawn after `inner`, so "per Research badge in
 * this column" comes out as one symbol.
 */
export interface RegionGlyph {
  g: 'region'
  region: Exclude<Region, 'org'>
  inner: SimpleGlyph
}

/**
 * Height of each glyph as a multiple of the font size.
 *
 * Optical, not nominal. Every icon's ink fills its box, so drawing them all at
 * one height makes the round ones look small next to the floor mark, whose
 * full-height bars carry their weight all the way to the edges. The floor mark
 * and the budget note are the benchmark, and the discs are raised until they
 * read level with them.
 *
 * A box taller than the text raises the line height, which cuts the line
 * budget, which can drop a card's whole block a rung down its size ladder.
 * These are as large as they go before they start paying for themselves in
 * smaller text.
 */
const GLYPH_EM: Record<SimpleGlyph['g'], number> = {
  floor: 1.25,
  budget: 1.25,
  // A slip is tall and narrow like the floor mark, so it needs less than a disc.
  approval: 1.35,
  // A card, cut to the same proportions as the slip.
  aiSeat: 1.35,
  elevator: 1.45,
  group: 1.45,
  missingGroup: 1.45,
  equal: 1.45,
  notEqual: 1.45,
  bag: 1.45,
  // Nine cells, so they need more than a symbol and less than the area diagram,
  // which also has to carry the pins marking which cells it means.
  emptySeat: 1.8,
  filledSeat: 1.8,
  // A grid of nine cells, so it is a diagram rather than a symbol.
  area: 2.1,
}

/**
 * The position marker's reach, as a fraction of the glyph it follows.
 *
 * Applied to the marker's LONGEST side, not its height, so all three read as
 * the same size: the both-ways marker is square, the horizontal one is wide and
 * short, the vertical one narrow and tall. Sizing them by height instead would
 * make the horizontal marker enormous and the vertical one a sliver.
 */
const MARKER_REACH = 0.62

/** Gap between the glyph and its marker, as a fraction of the glyph's height. */
const MARKER_GAP = 0.16

/** Design size of each position marker, which is where its aspect comes from. */
const MARKER_DESIGN: Record<
  Exclude<Region, 'org'>,
  { w: number; h: number }
> = {
  row: { w: 32, h: 14 },
  column: { w: 14, h: 32 },
  rowOrColumn: { w: 32, h: 32 },
}

/**
 * The marker's drawn size, in units of the glyph height it follows.
 *
 * The longest side gets `MARKER_REACH`; the short side follows from the
 * artwork's own proportions.
 */
function markerSize(region: Exclude<Region, 'org'>): { w: number; h: number } {
  const d = MARKER_DESIGN[region]
  const longest = Math.max(d.w, d.h)
  return {
    w: (d.w / longest) * MARKER_REACH,
    h: (d.h / longest) * MARKER_REACH,
  }
}

/** Design size of each glyph, which is where its aspect comes from. */
const DESIGN: Record<SimpleGlyph['g'], { w: number; h: number }> = {
  approval: { w: 28, h: 40 },
  budget: { w: 42, h: 26 },
  bag: { w: 30, h: 36 },
  aiSeat: { w: 28, h: 40 },
  elevator: { w: 32, h: 32 },
  emptySeat: { w: 30, h: 40 },
  filledSeat: { w: 30, h: 40 },
  group: { w: 40, h: 40 },
  missingGroup: { w: 40, h: 40 },
  floor: { w: 17, h: 20 },
  equal: { w: 40, h: 40 },
  notEqual: { w: 40, h: 40 },
  area: { w: 64, h: 80 },
}

const GROUP_NAMES: Record<Group, string> = {
  leadership: 'Leadership',
  people: 'People',
  research: 'Research',
  product: 'Product',
  engineering: 'Engineering',
  design: 'Design',
}

const FLOOR_NAMES: Record<Floor, string> = {
  management: 'Management',
  ic: 'IC',
}

const REGION_NAMES: Record<Exclude<Region, 'org'>, string> = {
  row: 'in this row',
  column: 'in this column',
  rowOrColumn: 'in this row or column',
}

const AREA_NAMES: Record<Area, string> = {
  topRow: 'the top row',
  middleRow: 'the middle row',
  bottomRow: 'the bottom row',
  leftColumn: 'the left column',
  middleColumn: 'the middle column',
  rightColumn: 'the right column',
  corner: 'a corner',
  edgeCenter: 'the middle of an edge',
}

const AREA_ICON: Record<Area, IconId> = {
  topRow: 'area-top-row',
  middleRow: 'area-middle-row',
  bottomRow: 'area-bottom-row',
  leftColumn: 'area-left-column',
  middleColumn: 'area-middle-column',
  rightColumn: 'area-right-column',
  corner: 'area-corner',
  edgeCenter: 'area-edge-center',
}

const REGION_ICON: Record<Exclude<Region, 'org'>, IconId> = {
  row: 'position-horizontal',
  column: 'position-vertical',
  rowOrColumn: 'position-both',
}

/** The glyph's name, and the only place one is written. */
export function glyphId(glyph: Glyph): string {
  switch (glyph.g) {
    case 'group':
      return `group:${glyph.group}`
    case 'floor':
      return `floor:${glyph.floor}`
    case 'area':
      return `area:${glyph.area}`
    case 'region':
      return `region:${glyph.region}:${glyphId(glyph.inner)}`
    default:
      return glyph.g
  }
}

const REGIONS: readonly Exclude<Region, 'org'>[] = [
  'row',
  'column',
  'rowOrColumn',
]
const AREAS = Object.keys(AREA_ICON) as Area[]
const FLOORS: readonly Floor[] = ['management', 'ic']

const parsed = new Map<string, Glyph | null>()

/**
 * Read an id back. Memoized because it runs inside `draw`, and safe to memoize
 * because it is a pure function of its argument.
 */
export function parseGlyph(id: string): Glyph | null {
  const hit = parsed.get(id)
  if (hit !== undefined) return hit
  const out = decode(id)
  parsed.set(id, out)
  return out
}

function decode(id: string): Glyph | null {
  const cut = id.indexOf(':')
  const kind = cut < 0 ? id : id.slice(0, cut)
  const arg = cut < 0 ? undefined : id.slice(cut + 1)
  if (kind !== 'region') return decodeSimple(kind, arg)
  const inner = arg === undefined ? -1 : arg.indexOf(':')
  if (arg === undefined || inner < 0) return null
  const region = arg.slice(0, inner) as Exclude<Region, 'org'>
  if (!REGIONS.includes(region)) return null
  const held = decode(arg.slice(inner + 1))
  // A ring inside a ring has nowhere to put the second one.
  if (!held || held.g === 'region') return null
  return { g: 'region', region, inner: held }
}

function decodeSimple(
  kind: string,
  arg: string | undefined,
): SimpleGlyph | null {
  switch (kind) {
    case 'approval':
    case 'budget':
    case 'bag':
    case 'aiSeat':
    case 'elevator':
    case 'emptySeat':
    case 'filledSeat':
    case 'missingGroup':
    case 'equal':
    case 'notEqual':
      return arg === undefined ? { g: kind } : null
    case 'group':
      return ALL_GROUPS.includes(arg as Group)
        ? { g: 'group', group: arg as Group }
        : null
    case 'floor':
      return FLOORS.includes(arg as Floor)
        ? { g: 'floor', floor: arg as Floor }
        : null
    case 'area':
      return AREAS.includes(arg as Area)
        ? { g: 'area', area: arg as Area }
        : null
    default:
      return null
  }
}

/** Width over height, from the artwork's own proportions. */
export function glyphAspect(glyph: Glyph): number {
  // A region is its glyph followed by a marker, so it is as wide as the two
  // plus the gap and exactly as tall as the glyph alone.
  if (glyph.g === 'region') {
    return glyphAspect(glyph.inner) + MARKER_GAP + markerSize(glyph.region).w
  }
  const d = DESIGN[glyph.g]
  return d.w / d.h
}

/**
 * Height in em, optically matched across the set.
 *
 * A region is exactly as tall as the glyph it marks. The marker sits beside the
 * glyph rather than ringing it, which is what gives the badge its full size: a
 * ring forces the pair to more than twice the height and shrinks the badge
 * inside below one standing on its own.
 */
function glyphHeightEm(glyph: Glyph): number {
  return glyph.g === 'region' ? glyphHeightEm(glyph.inner) : GLYPH_EM[glyph.g]
}

/** What the glyph says, so a paragraph carrying it still reads as a sentence. */
export function glyphAlt(glyph: Glyph): string {
  switch (glyph.g) {
    case 'approval':
      return 'approvals'
    case 'budget':
      return 'budget'
    case 'bag':
      return 'budget line'
    case 'aiSeat':
      return 'AI seat'
    case 'elevator':
      return 'the other floor'
    case 'emptySeat':
      return 'seat'
    case 'filledSeat':
      return 'seat'
    case 'group':
      return GROUP_NAMES[glyph.group]
    case 'missingGroup':
      return 'department'
    case 'floor':
      return FLOOR_NAMES[glyph.floor]
    case 'equal':
      return 'of one department'
    case 'notEqual':
      return 'different department'
    case 'area':
      return AREA_NAMES[glyph.area]
    case 'region':
      return `${glyphAlt(glyph.inner)} ${REGION_NAMES[glyph.region]}`
  }
}

/** How one glyph sits in the line, for the caller that knows what is beside it. */
export interface GlyphOptions {
  /** Space before and after, in em. */
  leadEm?: number
  trailEm?: number
  /**
   * Multiplier on the glyph's height.
   *
   * A glyph is sized against the words it sits among, which is right until
   * there are no words. A clause that is nothing but symbols has the whole band
   * to itself and reads better filling it.
   */
  scale?: number
  /**
   * What the glyph says here, overriding its own name.
   *
   * `glyphAlt` names a glyph out of context, and the spans around it decide how
   * it reads in one. Three slips in a row are "3 approvals" said once, not the
   * word three times, and a note after a figure is " budget" so the pair reads
   * "1k budget" rather than "1kbudget".
   */
  alt?: string
}

/**
 * The glyph as a span the engine can wrap.
 *
 * A box is not whitespace, so it welds to whatever sits against it. That is
 * what keeps a value with the symbol it qualifies, and it means anything that
 * wants a gap has to ask for one.
 */
export function glyphSpan(glyph: Glyph, options?: GlyphOptions): InlineBox {
  const { scale = 1, alt, ...space } = options ?? {}
  return {
    box: glyphId(glyph),
    heightEm: glyphHeightEm(glyph) * scale,
    aspect: glyphAspect(glyph),
    alt: alt ?? glyphAlt(glyph),
    ...space,
  }
}

/**
 * Paint a glyph into the rect a laid-out box run gives.
 *
 * Nothing is drawn until the rasteriser resolves. The space is already
 * reserved, so the line does not move when the artwork arrives.
 */
export function drawGlyph(
  gfx: Gfx2D,
  glyph: Glyph,
  x: number,
  y: number,
  height: number,
): void {
  const set = icons()
  if (!set) return
  if (glyph.g !== 'region') {
    drawIcon(gfx, set[simpleIcon(glyph)], x, y, height)
    return
  }
  // The glyph at full height, then its marker after it, centred on the glyph's
  // middle so a short marker does not sit on the baseline.
  const innerW = height * glyphAspect(glyph.inner)
  drawGlyph(gfx, glyph.inner, x, y, height)

  const marker = markerSize(glyph.region)
  const markerH = height * marker.h
  drawIcon(
    gfx,
    set[REGION_ICON[glyph.region]],
    x + innerW + height * MARKER_GAP,
    y + (height - markerH) / 2,
    markerH,
  )
}

/**
 * The artwork behind a glyph, as SVG source, for a renderer outside the canvas.
 *
 * One-piece glyphs only. A region is a glyph followed by a position marker,
 * which the board composes at draw time. No rule that asks the player a
 * question scores by region, so the DOM never needs the composite.
 */
export function glyphSvg(glyph: Glyph): string | null {
  return glyph.g === 'region' ? null : iconSvg(simpleIcon(glyph))
}

function simpleIcon(glyph: SimpleGlyph): IconId {
  switch (glyph.g) {
    case 'approval':
      return 'approval'
    case 'budget':
      return 'budget'
    case 'bag':
      return 'leftover-budget'
    case 'aiSeat':
      return 'ai-seat'
    case 'elevator':
      return 'elevator'
    case 'emptySeat':
      return 'grid-empty'
    case 'filledSeat':
      return 'grid-full'
    case 'group':
      return `group-${glyph.group}`
    case 'missingGroup':
      return 'group-missing'
    case 'floor':
      return `floor-${glyph.floor}-ink`
    case 'equal':
      return 'equal'
    case 'notEqual':
      return 'not-equal'
    case 'area':
      return AREA_ICON[glyph.area]
  }
}

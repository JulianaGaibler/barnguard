/**
 * What a playable map has to provide. The game itself is map-agnostic: it
 * frames a map, lets the player pick a region, puts an epicenter on that
 * region's start point, and routes packets into it. Everything that differs
 * between maps lives behind this descriptor.
 */

import type { BitmapMask, Rect, SvgPathEntry, Vec2 } from 'stargazer'
import type { PacketMask } from '../behaviors/PacketBehavior'

/**
 * A region's id within its own map. An open string rather than a union: each
 * map declares its own set (German ISO state codes, ISO 3166-1 alpha-3 country
 * codes) and nothing outside a map ever compares ids across maps.
 */
export type RegionId = string

/** One pickable (or merely drawn) piece of a map, resolved at load. */
export interface RegionInfo {
  id: RegionId
  /** Key under the owning map's i18n namespace, for the region's name. */
  i18nKey: string
  /**
   * False for geometry that belongs to the landmass but is not a playable
   * choice, which the Europe map uses for dependencies and contested territory.
   * A non-selectable region draws and never takes a tap.
   */
  selectable: boolean
  /**
   * Where this region's epicenter sits. A real capital where the map has one,
   * otherwise the deepest point inside the region's own outline.
   */
  startPoint: Vec2
  /**
   * The region's own outline, already tessellated. Carried here rather than
   * looked up by id, because a map's path keys need not match its region ids
   * and only the map knows how one maps to the other. The border strokes this.
   */
  shape: SvgPathEntry
  /**
   * Whether this region paints a fill of its own. False for a region the
   * artwork draws inside another, where both would paint and a translucent fill
   * painted twice reads brighter than the rest of the map. The enclosing
   * region's fill shows through instead, and the region stays delineated by its
   * own border.
   */
  drawsFill: boolean
}

/** The map-wide geometry a descriptor resolves at load. */
export interface MapGeometry {
  /**
   * The landmass, rasterized from every region merged into one shape. Used for
   * spawn rejection sampling, never as the failure boundary (see
   * `MapDescriptor.playAreaMask`).
   */
  landMask: BitmapMask
}

/** Live state the play-area mask needs to follow the camera. */
export interface PlayAreaContext {
  /** The game camera's current viewport, in map coordinates. */
  viewport(): Rect
}

export interface MapDescriptor {
  /**
   * Stable key for this map on the wire, carried on every game record so two
   * maps keep separate high scores. Mirrors the arcade's `gameId`: an open
   * string, so adding a map needs no server-side enum change.
   */
  id: string
  /** The region names' namespace within the display's messages. */
  i18nNamespace: 'states' | 'countries'
  geometry: MapGeometry
  /** Every drawn region, selectable or not, in a stable order. */
  regions: readonly RegionInfo[]
  /** Camera framing with no region selected. */
  idleView: Rect
  /**
   * Camera framing once `region` is chosen, which is also the rect the
   * play-area mask bounds during the round. `cameraAspect` is width over
   * height, so a map can fit its framing to the live canvas.
   */
  playViewFor(region: RegionInfo, cameraAspect: number): Rect
  /**
   * The boundary whose crossing ends the round. Germany reads its own
   * coastline, so a packet is lost by leaving the country. Europe bounds only
   * the left and right of the view, so a packet is lost by leaving the screen
   * sideways while the top and bottom turn it back.
   */
  playAreaMask(ctx: PlayAreaContext): PacketMask
  /**
   * Whether the splash's self-playing round is lost at the play-area boundary
   * as well as by a collision. True where the boundary is a real edge of the
   * map, such as Germany's coastline. False where it is only the edge of the
   * screen, as on Europe, since a packet lost there would end a round at
   * nothing the player can see.
   */
  previewLostAtBorder: boolean
  /**
   * Whether the screen's left and right edges are where a packet is lost, so
   * the playing screen marks them. True on Europe. False where the loss line is
   * a coastline the map already draws.
   */
  edgesAreFailLine: boolean
  /** Grid overlay cell size in map units, scaled to the map's own extent. */
  gridCellWorld: number
  /**
   * Outline the grid overlay's dots are limited to, or `null` for a grid over
   * the whole map. A map whose coastline decides play draws the dots on land
   * only. A map where play ends at the screen's edges draws them across the
   * playing field, since its coastline is not a boundary.
   */
  gridMask: BitmapMask | null
  /**
   * Neighbour graph driving the selection ripple's BFS order. Optional: a map
   * without one ripples outward by distance from the selected region instead,
   * which is why a 44-country graph does not have to be authored by hand.
   */
  adjacency?: Readonly<Record<RegionId, readonly RegionId[]>>
}

/** Look up a region by id, or `undefined` when the map has no such region. */
export function findRegion(
  map: MapDescriptor,
  id: RegionId,
): RegionInfo | undefined {
  return map.regions.find((r) => r.id === id)
}

/** Regions a player may choose, in the map's own order. */
export function selectableRegions(map: MapDescriptor): readonly RegionInfo[] {
  return map.regions.filter((r) => r.selectable)
}

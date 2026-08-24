/**
 * A chunky slab, lit and turned on a single axis. The drawing primitive behind
 * a board whose pieces should read as physical objects rather than flat fills.
 *
 * Everything behaves as though the light were directly overhead and the board
 * tilted toward the viewer, so both cues are purely vertical displacements and
 * both read as horizontal bands: the extruded side shows as a strip below a
 * slab, and the lit edge as a strip along its top. Nothing is offset sideways,
 * so a column of slabs shares one silhouette left and right.
 *
 * The skirt is the face's own shape translated straight down, not a separate
 * rectangle. Because the two are identical in size and radius, every part of it
 * except a `depth`-tall sliver at the bottom sits exactly behind the face, so
 * no square corner can peek out from behind a rounded one.
 *
 * `h` is the height of the WHOLE slab, extrusion included, so a slab given a
 * square `w`/`h` occupies exactly that square. The face is shortened to make
 * room for its own side rather than the side hanging off the bottom, which is
 * what lets a slab sit inside its grid cell instead of overflowing it.
 *
 * Every edge is hard. Nothing here blurs, and a caller wanting a soft shadow
 * needs a different primitive.
 *
 * @example
 *   drawSlab(gfx, {
 *     x,
 *     y,
 *     w,
 *     h,
 *     radius,
 *     depth,
 *     face,
 *     skirt,
 *     highlight,
 *     band,
 *   })
 */
import type { Gfx2D } from '@src/stargazer'

/** One slab. All measurements are world units. */
export interface Slab {
  x: number
  y: number
  w: number
  h: number
  radius: number
  /** Height of the visible side, taken out of `h` rather than added to it. */
  depth: number
  face: string
  /** The extruded side, turned away from the light. Usually the face darkened. */
  skirt: string
  /** The lit top edge. Usually the face lightened. */
  highlight: string
  /** Height of that band. */
  band: number
}

/** A raised slab: the side, then the lit edge, then the face over it. */
export function drawSlab(gfx: Gfx2D, s: Slab): void {
  const r = s.radius
  const faceH = Math.max(1, s.h - s.depth)
  if (s.depth > 0) {
    gfx.fillRoundRect(s.x, s.y + s.depth, s.w, faceH, r, s.skirt)
  }
  gfx.fillRoundRect(s.x, s.y, s.w, faceH, r, s.highlight)
  gfx.fillRoundRect(s.x, s.y + s.band, s.w, faceH - s.band, r, s.face)
}

/** Centre of a slab's top face, measured from the slab's own top edge. */
export function faceCenterY(h: number, depth: number): number {
  return (h - depth) / 2
}

/**
 * A recessed pocket: the same construction inverted. Lit from overhead, a
 * raised slab is bright along its top edge, so a hollow is dark along its top
 * edge.
 */
export function drawWell(
  gfx: Gfx2D,
  x: number,
  y: number,
  w: number,
  h: number,
  radius: number,
  fill: string,
  rim: string,
  band: number,
): void {
  gfx.fillRoundRect(x, y, w, h, radius, rim)
  gfx.fillRoundRect(x, y + band, w, h - band, radius, fill)
}

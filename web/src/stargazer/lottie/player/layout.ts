/**
 * Fit and alignment math for placing content of one size inside a box of
 * another size. Pure arithmetic with no dependency on a renderer or a scene.
 */

/** How content is scaled to a box. */
export type LayoutFit =
  'contain' | 'cover' | 'fill' | 'fit-width' | 'fit-height' | 'none'

/** Alignment along one axis, as a name or a number from 0 (start) to 1 (end). */
export type LayoutAlign = number | 'start' | 'center' | 'end'

/** Scale and translation that place content inside a box. */
export interface LayoutResult {
  scaleX: number
  scaleY: number
  /** Offset of the scaled content's start edge inside the box. */
  x: number
  /** Offset of the scaled content's top edge inside the box. */
  y: number
}

function alignValue(align: LayoutAlign): number {
  if (align === 'start') return 0
  if (align === 'center') return 0.5
  if (align === 'end') return 1
  return align < 0 ? 0 : align > 1 ? 1 : align
}

/**
 * Compute the scale and offset that place `content` inside `box`.
 *
 * `contain` scales uniformly until all of the content is visible, `cover`
 * scales uniformly until the box is filled, `fill` scales each axis on its own,
 * `fit-width` and `fit-height` scale uniformly to one axis, and `none` keeps
 * the content size. The offset is the free space on each axis multiplied by the
 * alignment, so `center` leaves equal margins.
 *
 * @remarks
 *   Pass `out` to reuse an object and avoid an allocation per call. Content with
 *   a zero or negative size yields an identity scale and a zero offset.
 * @example
 *   const l = computeLayout(
 *     1500,
 *     1500,
 *     400,
 *     300,
 *     'contain',
 *     'center',
 *     'start',
 *   )
 *   // l.scaleX === 0.2, l.x === 50, l.y === 0
 */
export function computeLayout(
  contentW: number,
  contentH: number,
  boxW: number,
  boxH: number,
  fit: LayoutFit = 'contain',
  alignX: LayoutAlign = 'center',
  alignY: LayoutAlign = 'center',
  out: LayoutResult = { scaleX: 1, scaleY: 1, x: 0, y: 0 },
): LayoutResult {
  if (!(contentW > 0) || !(contentH > 0)) {
    out.scaleX = 1
    out.scaleY = 1
    out.x = 0
    out.y = 0
    return out
  }
  const rx = boxW / contentW
  const ry = boxH / contentH
  let sx = 1
  let sy = 1
  switch (fit) {
    case 'contain':
      sx = sy = Math.min(rx, ry)
      break
    case 'cover':
      sx = sy = Math.max(rx, ry)
      break
    case 'fill':
      sx = rx
      sy = ry
      break
    case 'fit-width':
      sx = sy = rx
      break
    case 'fit-height':
      sx = sy = ry
      break
    case 'none':
      break
  }
  out.scaleX = sx
  out.scaleY = sy
  out.x = (boxW - contentW * sx) * alignValue(alignX)
  out.y = (boxH - contentH * sy) * alignValue(alignY)
  return out
}

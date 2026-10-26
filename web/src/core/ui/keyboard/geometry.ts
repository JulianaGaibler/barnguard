/**
 * Where the accent strip sits and which of its cells a point is over. All boxes
 * are in one coordinate space, relative to the keyboard.
 *
 * The strip is a row of key-sized cells above the held key, growing toward the
 * middle of the keyboard and kept inside its edges. Cell 0, the plain letter,
 * is at the end nearest the key.
 */

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

export interface StripLayout extends Box {
  /** Left edge of each cell, in cell order. */
  cellLefts: readonly number[]
  cellWidth: number
  gap: number
  /** How far above the strip a point may be and still pick a cell. */
  reach: number
  /** Bottom of the held key, the lowest a point may be and pick a cell. */
  floor: number
}

/**
 * @param key The held key.
 * @param bounds The span the strip stays inside, in the same coordinates.
 * @param count Cells in the strip, the plain letter included.
 * @param gap Space between cells, and between the strip and the key.
 */
export function stripLayout(
  key: Box,
  bounds: { left: number; width: number },
  count: number,
  gap: number,
): StripLayout {
  const cellWidth = key.width
  const width = count * cellWidth + (count - 1) * gap
  const growsRight = key.left + key.width / 2 < bounds.left + bounds.width / 2
  const ideal = growsRight ? key.left : key.left + key.width - width
  const left = Math.max(
    bounds.left,
    Math.min(ideal, bounds.left + bounds.width - width),
  )
  const cellLefts = Array.from({ length: count }, (_, i) =>
    growsRight
      ? left + i * (cellWidth + gap)
      : left + width - cellWidth - i * (cellWidth + gap),
  )
  return {
    left,
    top: key.top - gap - key.height,
    width,
    height: key.height,
    cellLefts,
    cellWidth,
    gap,
    reach: key.height,
    floor: key.top + key.height,
  }
}

/**
 * The cell nearest to `x`, or null when the point is outside the band that runs
 * from one key height above the strip down to the bottom of the held key, or
 * more than half a cell beyond either end of the strip.
 */
export function stripCellAt(
  layout: StripLayout,
  x: number,
  y: number,
): number | null {
  if (y < layout.top - layout.reach || y > layout.floor) return null
  const slack = layout.cellWidth / 2
  if (x < layout.left - slack || x > layout.left + layout.width + slack) {
    return null
  }
  let nearest = 0
  let nearestDistance = Infinity
  layout.cellLefts.forEach((cellLeft, i) => {
    const distance = Math.abs(x - (cellLeft + layout.cellWidth / 2))
    if (distance < nearestDistance) {
      nearest = i
      nearestDistance = distance
    }
  })
  return nearest
}

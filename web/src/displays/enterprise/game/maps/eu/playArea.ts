import type { Rect } from '@src/stargazer'
import type { PacketMask } from '../../behaviors/PacketBehavior'

/**
 * A play area bounded on the left and right by the camera's own view, and
 * unbounded vertically.
 *
 * This is what makes a packet lost by sliding off the side of the screen. The
 * vertical axis is deliberately open, because `PacketBehavior` reads the same
 * mask twice for two different questions:
 *
 * - `contains(x, y, 0)` is the exit gate. False only past the left or right
 *   edge, so those are the only ways to lose a packet.
 * - `contains(x, y, inset)` gates the viewport turnaround. Returning false
 *   near the left and right edges stops the turnaround steering a packet back
 *   inward there, letting it fly out. Staying true for every `y` leaves the
 *   turnaround free to bounce packets off the top and bottom, which keeps them
 *   on screen rather than drifting away unseen.
 */
export class ScreenEdgeMask implements PacketMask {
  readonly #viewport: () => Rect

  constructor(viewport: () => Rect) {
    this.#viewport = viewport
  }

  contains(x: number, _y: number, inset: number): boolean {
    const r = this.#viewport()
    return x >= r.x + inset && x <= r.x + r.width - inset
  }
}

/**
 * Framing for a selected region: wide enough to hold the region with padding,
 * never narrower than `minWidth`, never wider than the map, and shifted to sit
 * inside the map's own bounds.
 *
 * `minWidth` is the floor that matters most. Gameplay distances (spawn
 * separation, the epicenter keep-out radius) are tuned in map units, so a
 * framing scaled to Luxembourg alone would leave no room to play. The result is
 * that large countries fill most of the width and small ones sit in a view
 * sized by the game rather than by the country.
 */
export function fitRegionView(
  bounds: Rect,
  centre: { x: number; y: number },
  map: Rect,
  aspect: number,
  opts: { padding: number; minWidth: number },
): Rect {
  const padded = Math.max(
    bounds.width * opts.padding,
    bounds.height * opts.padding * aspect,
    opts.minWidth,
  )
  const width = Math.min(padded, map.width)
  const height = width / aspect
  // Centre on the region, then slide back inside the map so the camera never
  // frames empty space beyond the coastline.
  const x = clamp(centre.x - width / 2, map.x, map.x + map.width - width)
  const y = clamp(centre.y - height / 2, map.y, map.y + map.height - height)
  return { x, y, width, height }
}

function clamp(v: number, lo: number, hi: number): number {
  // `hi < lo` when the framing is taller than the map, which a very wide
  // aspect can produce. Centre it in that case rather than inverting.
  if (hi < lo) return (lo + hi) / 2
  return v < lo ? lo : v > hi ? hi : v
}

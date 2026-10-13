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
 * - `contains(x, y, 0)` is the exit gate. False only past the left or right edge,
 *   so those are the only ways to lose a packet.
 * - `contains(x, y, inset)` gates the viewport turnaround. Returning false near
 *   the left and right edges stops the turnaround steering a packet back inward
 *   there, letting it fly out. Staying true for every `y` leaves the turnaround
 *   free to bounce packets off the top and bottom, which keeps them on screen
 *   rather than drifting away unseen.
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
 * Framing for a selected region: the map's full width, cropped vertically to a
 * band holding that region.
 *
 * The width is never reduced, so the map is never cut off on the left or right.
 * Two things follow from that. The zoom is the same for every region, which
 * keeps gameplay distances (tuned in map units) identical wherever the player
 * picks, and because the band's aspect is taken from the canvas, the view fits
 * exactly: the map's left and right edges land on the screen's, so the edges a
 * packet is lost at are the ones the player can see.
 *
 * The band centres on the region's `bounds`, not on its start point. A concave
 * or multi-part country has its deepest interior point well off its own centre
 * (Norway's sits in the southern bulk), and centring there would push the north
 * off screen.
 */
export function fitRegionBand(bounds: Rect, map: Rect, aspect: number): Rect {
  const width = map.width
  const height = width / aspect
  const centreY = bounds.y + bounds.height / 2
  return {
    x: map.x,
    y: clampBand(centreY - height / 2, map.y, map.y + map.height - height),
    width,
    height,
  }
}

function clampBand(v: number, lo: number, hi: number): number {
  // `hi < lo` when the band is taller than the map, which a canvas narrower
  // than the map's own aspect produces. Centre it rather than inverting, and
  // let the camera letterbox above and below.
  if (hi < lo) return (lo + hi) / 2
  return v < lo ? lo : v > hi ? hi : v
}

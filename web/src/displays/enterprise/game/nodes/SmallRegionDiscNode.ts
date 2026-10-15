import {
  Node2D,
  type CameraView2D,
  type Gfx2D,
  type GfxFill,
  type GfxLinearGradient,
} from '@src/stargazer'

/** Diameter of a disc on a 1080 pixel tall canvas, in CSS pixels. */
export const DISC_DIAMETER_CSS_PX = 56

/** The smallest a disc gets on a short canvas, which is still a tap target. */
export const DISC_MIN_DIAMETER_CSS_PX = 36

/**
 * A disc's diameter in CSS pixels for a canvas of the given CSS size: the
 * design size scaled with the canvas, and never below the tap target floor.
 */
export function discDiameter(cssW: number, cssH: number): number {
  const scale = Math.min(cssW / 1920, cssH / 1080)
  return Math.max(DISC_MIN_DIAMETER_CSS_PX, DISC_DIAMETER_CSS_PX * scale)
}

/** Width of the disc's border on screen, in CSS pixels. */
const BORDER_CSS_PX = 3

const FILL_STOPS: GfxLinearGradient['stops'] = [
  { offset: 0, color: 'rgba(255, 255, 255, 0.5)' },
  { offset: 1, color: 'rgba(255, 255, 255, 0.8)' },
]
const FILL_STOPS_SELECTED: GfxLinearGradient['stops'] = [
  { offset: 0, color: 'rgba(255, 255, 255, 0.75)' },
  { offset: 1, color: 'rgba(255, 255, 255, 1)' },
]

/**
 * A circle standing in for a region too small to tap, drawn with the same glass
 * fill, inner glow and border as a region and centred on the point the region's
 * land is deepest at.
 *
 * The size is fixed on screen, so the disc is the same tap target at the map's
 * overview and zoomed in, and follows the canvas size. `radiusWorld` is the
 * radius as of the last draw, which is what a hit test reads.
 */
export class SmallRegionDiscNode extends Node2D {
  /** Whether the disc draws as the chosen region. */
  selected = false

  /** Radius in world units as of the last draw. */
  radiusWorld = 0

  /** Diameter on screen in CSS pixels, set by the owner as the canvas resizes. */
  diameterCssPx = DISC_DIAMETER_CSS_PX

  readonly regionId: string

  constructor(regionId: string, x: number, y: number) {
    super(`disc-${regionId}`)
    this.regionId = regionId
    this.transform.x = x
    this.transform.y = y
  }

  /** Whether world point `(x, y)` is on the disc, as of the last draw. */
  contains(x: number, y: number): boolean {
    const dx = x - this.transform.x
    const dy = y - this.transform.y
    return dx * dx + dy * dy <= this.radiusWorld * this.radiusWorld
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const scale = camera.screenPxPerWorldUnit()
    if (scale <= 0) return
    const r = this.diameterCssPx / 2 / scale
    this.radiusWorld = r
    const fill: GfxFill = {
      kind: 'linear',
      x0: 0,
      y0: -r,
      x1: 0,
      y1: r,
      stops: this.selected ? FILL_STOPS_SELECTED : FILL_STOPS,
    }
    gfx.fillCircle(0, 0, r, fill)
    gfx.shadowCircle(0, 0, r, {
      color: 'rgba(255, 255, 255, 0.5)',
      blur: r * 0.5,
      inset: true,
    })
    gfx.strokeCircle(0, 0, r, {
      color: 'rgba(255, 255, 255, 0.9)',
      width: BORDER_CSS_PX / scale,
    })
  }
}

import { Layer, ShapeNode, type Rect } from '@src/stargazer'
import { DESIGN_HEIGHT, DESIGN_WIDTH } from '@src/core/ui/designRegion'
import { PALETTE } from '../theme'
import { backgroundDither } from './ditherLook'

/**
 * A dark spot that fades to nothing, centered just past a corner of the visible
 * area. Both stay clear of the text, the answers and the buttons.
 */
const SPOTS = [
  { corner: 'top-right', radius: 470 },
  { corner: 'bottom-left', radius: 360 },
] as const

/** How far past its corner a spot is centered. */
const OVERSHOOT = 80

/** The color of a spot at its center. Its alpha falls to 0 at the rim. */
const SPOT_CENTER = 'rgba(22, 22, 22, 1)'
const SPOT_RIM = 'rgba(22, 22, 22, 0)'

/** The field behind the screens, and how to fit it to the visible area. */
export interface Background {
  readonly layer: Layer
  /** Moves the spots to the corners of `area`, the world the window shows. */
  fit(area: Rect): void
}

/**
 * The field behind the screens: two dark spots on white, which the dither turns
 * into red dots that thin out away from the corners. The spots sit at the
 * corners of the visible area, so they stay in the window's corners at any
 * shape. Nothing in it moves between resizes, so the layer keeps its render and
 * draws it as one quad. Add it to the scene first, so it draws under everything
 * else.
 */
export function createBackground(): Background {
  const layer = new Layer({
    id: 'background',
    space: {
      frame: { x: 0, y: 0, width: DESIGN_WIDTH, height: DESIGN_HEIGHT },
    },
    region: 'view',
    cache: 'raster',
    clearColor: PALETTE.white,
    effects: [backgroundDither()],
    persistent: true,
  })
  const nodes = SPOTS.map(() => {
    const node = new ShapeNode({
      geometry: { kind: 'rect', width: 1, height: 1, centered: false },
    })
    layer.add(node)
    return node
  })
  return {
    layer,
    fit(area) {
      SPOTS.forEach((spot, index) => {
        const node = nodes[index]
        // The node covers the whole area, and the gradient is in its own space.
        node.transform.x = area.x
        node.transform.y = area.y
        node.geometry = {
          kind: 'rect',
          width: area.width,
          height: area.height,
          centered: false,
        }
        node.fill = {
          kind: 'radial',
          cx: spot.corner === 'top-right' ? area.width + OVERSHOOT : -OVERSHOOT,
          cy:
            spot.corner === 'top-right' ? -OVERSHOOT : area.height + OVERSHOOT,
          r: spot.radius,
          stops: [
            { offset: 0, color: SPOT_CENTER },
            { offset: 1, color: SPOT_RIM },
          ],
        }
      })
    },
  }
}

import { DualKawaseBlur, FilmGrain, Layer, type Rect } from 'stargazer'
import { GradientBackdropNode } from './GradientBackdropNode'
import { SliceShift } from './SliceShift'

/** The size the backdrop's gradient and its slices are authored at. */
const FRAME: Rect = { x: 0, y: 0, width: 1920, height: 1080 }

/** The color behind the gradient, and the canvas's clear color. */
export const BACKDROP_CLEAR_COLOR = '#D1C3F4'

/** How many slices the backdrop is cut into. */
const SLICE_COLUMNS = 11

/** How long a change between the two gradients takes. */
export const BACKDROP_FADE_SEC = 0.6

/**
 * The brand background: a blurred, sliced, grained gradient, as a layer of the
 * game's own scene. The effects cover the layer and leave the map crisp,
 * because they run over the layer's region and nothing else.
 *
 * Every input is time-invariant (a fixed gradient, a fixed slice, grain at `hz:
 * 0`), so the layer keeps its rendered result and draws it as one quad until
 * the canvas resizes or `node.radialMix` moves, which renders it again for as
 * long as it changes. The region is the whole canvas and the layer is fitted to
 * the design frame, so the map camera never moves it, and the gradient reaches
 * past the frame to fill any canvas shape.
 *
 * Add it to the scene first, so it draws under everything else, and call
 * `layer.warm()` once it is there. See `SliceShift.ts` and
 * `GradientBackdropNode.ts`.
 */
export function createBackdropLayer(): {
  layer: Layer
  node: GradientBackdropNode
} {
  const layer = new Layer({
    id: 'backdrop',
    space: { frame: FRAME },
    region: 'view',
    cache: 'raster',
    clearColor: BACKDROP_CLEAR_COLOR,
    effects: [
      new DualKawaseBlur({ levels: 6, offset: 3 }),
      new SliceShift({ columns: SLICE_COLUMNS }),
      new FilmGrain({ density: 0.1, opacity: 0.1, hz: 0 }),
    ],
    persistent: true,
  })
  const node = new GradientBackdropNode(FRAME.width, FRAME.height)
  layer.add(node)
  return { layer, node }
}

import { Node2D, parseSvgPaths, type Gfx2D } from '@src/stargazer'
import handSvgRaw from './hand.svg?raw'

/**
 * Fingertip position inside the hand SVG's viewBox — the (non-rendered)
 * `<circle>` marker. The hand is drawn shifted by `-(x, y)` so the fingertip
 * lands on the node's transform origin; position the node (and its alpha) to
 * place / fade the finger.
 */
const FINGERTIP = { x: 22, y: 10 }

/** SVG viewBox is 238×277; scale it to read as a hand on the field. */
const HAND_SCALE = 1.2

// Inverted from the source asset (dark hand + light creases) so it reads on the
// tutorial's light card/panel. Draw order matches the SVG: silhouette first,
// then the detail/crease layer on top.
const SILHOUETTE_COLOR = '#ffffff'
const HAND_COLOR = '#17171b'

// Parse once at module load; the two <path>s are the silhouette then the
// crease/detail overlay. Tessellated so the GPU backend can fill them.
const HAND_PATHS = Array.from(
  parseSvgPaths(handSvgRaw, { tessellate: true }).paths.values(),
)

/**
 * A hand cue for the tutorials. Its fingertip sits at the node's transform
 * origin, so a demo positions it with `transform.x/y` and fades it with
 * `transform.alpha`. Starts hidden.
 */
export class FingerHintNode extends Node2D {
  constructor() {
    super('finger-hint')
    this.renderLayer = 'dynamic'
    this.visible = false
    this.transform.alpha = 0
  }

  override draw(gfx: Gfx2D): void {
    if (HAND_PATHS.length < 2) return
    gfx.save()
    gfx.scale(HAND_SCALE, HAND_SCALE)
    gfx.translate(-FINGERTIP.x, -FINGERTIP.y)
    gfx.fillPath2D(HAND_PATHS[0].path, SILHOUETTE_COLOR)
    gfx.fillPath2D(HAND_PATHS[1].path, HAND_COLOR)
    gfx.restore()
  }
}

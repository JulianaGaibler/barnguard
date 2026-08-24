/**
 * One tile: an extruded slab with a numeral on it.
 *
 * The node's transform carries the tile's position and any pop or squash, so
 * `draw` always paints a slab centered on the origin. That keeps a merge pop
 * scaling about the tile's middle rather than its corner.
 *
 * Depth grows with value, which is the point of the whole treatment: a 1024
 * visibly stands taller than the 2 beside it. It is also why `TileLayerNode`
 * has to paint tiles in row order (see its header), because a tall tile's skirt
 * reaches toward the row below it.
 */
import {
  easings,
  fitFontSize,
  ignoreAbort,
  Node2D,
  type Gfx2D,
} from '@src/stargazer'
import { headingFont } from '../../fonts'
import {
  ANIM,
  BEVEL,
  tileColor,
  tileDepth,
  tileHighlight,
  tileInk,
  tileSkirt,
} from '../tuning'
import { drawSlab, faceCenterY } from '../../../common/bevel'

/**
 * Candidate numeral sizes as fractions of the cell, largest first.
 * {@link fitFontSize} walks these and takes the first that fits, so a five-digit
 * tile shrinks on measured width rather than on a guessed step: the old
 * hand-tuned ladder stopped at four digits and 65536 overflowed its tile.
 */
const NUMERAL_STEPS = [0.44, 0.4, 0.36, 0.32, 0.28, 0.24, 0.2]

/** Share of the tile's width a numeral may occupy before it is stepped down. */
const NUMERAL_FIT = 0.78

export class TileNode extends Node2D {
  #value: number
  #cell: number
  /** Measured in `#refit`, since neither the value nor the cell changes often. */
  #font = ''
  /**
   * Bumped by every slide. A fast player can start a second slide before the
   * first one's squash has recovered, and without this the older recovery would
   * fire partway through the newer squash and undo it.
   */
  #landEpoch = 0

  constructor(value: number, cell: number) {
    super('t48-tile')
    this.renderLayer = 'dynamic'
    this.#value = value
    this.#cell = cell
    this.transform.originX = 0.5
    this.transform.originY = 0.5
    this.#refit()
  }

  get value(): number {
    return this.#value
  }

  /** Re-measure after a resize. */
  setCell(cell: number): void {
    this.#cell = cell
    this.#refit()
  }

  #refit(): void {
    // The extrusion is taken out of the tile's height, not added to it, so the
    // whole slab is exactly the square its grid cell reserves for it.
    const c = this.#cell
    this.debugBounds = { x: -c / 2, y: -c / 2, width: c, height: c }
    const label = String(this.#value)
    const size = fitFontSize(
      label,
      NUMERAL_STEPS.map((f) => c * f),
      (px) => headingFont(700, px),
      c * NUMERAL_FIT,
    )
    this.#font = headingFont(700, size)
  }

  /** Move to a new cell center over the standard slide, then land. */
  slideTo(x: number, y: number): void {
    this.play(
      { x, y },
      { duration: ANIM.slide, easing: easings.outCubic, key: 'slide' },
    )
    this.#land()
  }

  /** Put the tile at a cell center with no animation. */
  snapTo(x: number, y: number): void {
    this.transform.x = x
    this.transform.y = y
  }

  /** Scale up from nothing, the way a freshly dealt tile arrives. */
  appear(): void {
    this.transform.scaleX = 0
    this.transform.scaleY = 0
    this.play(
      { scaleX: 1, scaleY: 1 },
      { duration: ANIM.spawn, easing: easings.outBack, key: 'pop' },
    )
  }

  /** Overshoot and settle, the way a merged tile announces itself. */
  pop(): void {
    const s = ANIM.popScale
    this.transform.scaleX = 1
    this.transform.scaleY = 1
    this.tween(
      { scaleX: s, scaleY: s },
      { duration: ANIM.pop * 0.4, easing: easings.outQuad, key: 'pop' },
    )
      .then(() =>
        this.tween(
          { scaleX: 1, scaleY: 1 },
          { duration: ANIM.pop * 0.6, easing: easings.outBack, key: 'pop' },
        ),
      )
      .catch(ignoreAbort)
  }

  /** Squash on arrival, so a slide reads as weight rather than a glide. */
  #land(): void {
    const squash = ANIM.landSquash
    const epoch = ++this.#landEpoch
    this.play(
      { scaleY: 1 - squash, scaleX: 1 + squash * 0.6 },
      { duration: ANIM.slide, easing: easings.outQuad, key: 'land' },
    )
    this.wait(ANIM.slide)
      .then(() => {
        if (epoch !== this.#landEpoch) return
        this.play(
          { scaleY: 1, scaleX: 1 },
          { duration: ANIM.landRecover, easing: easings.outBack, key: 'land' },
        )
      })
      .catch(ignoreAbort)
  }

  /** Slide onto the merge cell and vanish there, leaving the merged tile. */
  absorbInto(x: number, y: number): void {
    this.play(
      { x, y },
      { duration: ANIM.slide, easing: easings.outCubic, key: 'slide' },
    )
    this.wait(ANIM.slide)
      .then(() => {
        if (!this.isDestroyed) this.destroy()
      })
      .catch(ignoreAbort)
  }

  override draw(gfx: Gfx2D): void {
    const c = this.#cell
    const half = c / 2
    const value = this.#value

    const depth = tileDepth(c, value)
    drawSlab(gfx, {
      x: -half,
      y: -half,
      w: c,
      h: c,
      radius: c * BEVEL.radiusFrac,
      depth,
      face: tileColor(value),
      skirt: tileSkirt(value),
      highlight: tileHighlight(value),
      band: c * BEVEL.bandFrac,
    })

    // Centred on the top face, which the extrusion has shortened, rather than
    // on the cell: otherwise every numeral sits low by half the depth.
    gfx.fillText(String(value), 0, -half + faceCenterY(c, depth), {
      font: this.#font,
      align: 'center',
      baseline: 'middle',
      color: tileInk(value),
    })
  }
}

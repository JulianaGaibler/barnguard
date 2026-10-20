import {
  Node2D,
  ShapeNode,
  TextNode,
  fontMetrics,
  mixColor,
} from '@src/stargazer'
import { FAMILIES, fontWith } from '@src/core/theme/fonts'
import { PALETTE } from '../theme'
import { TILE_SIZE } from './rowLayout'

const HALF = TILE_SIZE / 2
const LETTER_SIZE = 96
const LETTER_WEIGHT = 600

/**
 * How an answer looks at one moment. The director tweens these numbers and
 * calls `apply`, so every node of the row follows one set of values.
 */
export interface RowPose {
  /** The square and its letter. */
  alpha: number
  /** The HTML label, which is anchored to the row's slot. */
  labelAlpha: number
  offsetX: number
  offsetY: number
  /** The square's size, around its center. */
  scale: number
  /** Extra offset of the square alone, for its flight to the progress row. */
  flightX: number
  flightY: number
  letterAlpha: number
  /** Corner radius of the square, up to half its side for a circle. */
  radius: number
  /** 0 is the black square, 1 is red. */
  red: number
}

export const RESTING_POSE: Readonly<RowPose> = {
  alpha: 1,
  labelAlpha: 1,
  offsetX: 0,
  offsetY: 0,
  scale: 1,
  flightX: 0,
  flightY: 0,
  letterAlpha: 1,
  radius: 0,
  red: 0,
}

/**
 * One answer's engine nodes. `slot` sits at the row's top left and carries the
 * HTML label, which anchors to it. `tile` is the black square with its letter,
 * pivoting on the square's center so it can shrink and turn into a circle.
 */
export class AnswerRow {
  readonly slot = new Node2D('answer-slot')
  readonly tile = new Node2D('answer-tile')
  readonly square: ShapeNode
  readonly letter: TextNode
  readonly pose: RowPose = { ...RESTING_POSE }
  #x = 0
  #y = 0
  #drawnRadius = -1

  constructor(letter: string) {
    this.square = new ShapeNode({
      id: 'answer-square',
      geometry: {
        kind: 'rect',
        width: TILE_SIZE,
        height: TILE_SIZE,
        radii: 0,
      },
      fill: PALETTE.black,
    })
    const font = fontWith(
      FAMILIES.mozillaHeadlineCondensed,
      LETTER_WEIGHT,
      LETTER_SIZE,
    )
    this.letter = new TextNode({
      id: 'answer-letter',
      text: letter,
      fontFamily: FAMILIES.mozillaHeadlineCondensed,
      fontWeight: LETTER_WEIGHT,
      fontSize: LETTER_SIZE,
      sizeSpace: 'world',
      color: PALETTE.white,
      align: 'center',
      baseline: 'alphabetic',
      // The page's type style closes up its letters by 0.02em, which shifts a
      // lone centered letter right by half of that. The engine's text has no
      // letter spacing, so the shift is applied by hand.
      x: LETTER_SIZE * 0.01,
      // The cap height, not the em box, is what looks centered in the square.
      y: fontMetrics(font).capHeight / 2,
    })
    this.tile.add(this.square, this.letter)
    this.apply()
  }

  /** The center of the square at rest, in the parent's space. */
  get center(): { x: number; y: number } {
    return { x: this.#x + HALF, y: this.#y + HALF }
  }

  /** Puts the row's top left at `(x, y)` in the parent's space. */
  place(x: number, y: number): void {
    this.#x = x
    this.#y = y
    this.apply()
  }

  /** Writes the pose to the nodes. */
  apply(): void {
    const p = this.pose
    this.slot.transform.x = this.#x + p.offsetX
    this.slot.transform.y = this.#y + p.offsetY
    this.slot.transform.alpha = p.labelAlpha
    this.tile.transform.x = this.#x + HALF + p.offsetX + p.flightX
    this.tile.transform.y = this.#y + HALF + p.offsetY + p.flightY
    this.tile.transform.scaleX = p.scale
    this.tile.transform.scaleY = p.scale
    this.tile.transform.alpha = p.alpha
    this.letter.transform.alpha = p.letterAlpha
    if (p.radius !== this.#drawnRadius) {
      this.#drawnRadius = p.radius
      this.square.geometry = {
        kind: 'rect',
        width: TILE_SIZE,
        height: TILE_SIZE,
        radii: Math.min(Math.max(p.radius, 0), HALF),
      }
    }
    this.square.fill = mixColor(PALETTE.black, PALETTE.red, p.red)
  }

  /** Adds the row's nodes to `parent`. */
  attachTo(parent: Node2D): void {
    parent.add(this.slot, this.tile)
  }

  destroy(): void {
    this.slot.destroy()
    this.tile.destroy()
  }
}

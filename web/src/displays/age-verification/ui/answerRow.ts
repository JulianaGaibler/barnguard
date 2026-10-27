import {
  GfxPath,
  Node2D,
  ShapeNode,
  TextNode,
  fontMetrics,
  mixColor,
  type Canvas,
} from 'stargazer'
import { FAMILIES, fontWith } from '@src/core/theme/fonts'
import { PALETTE } from '../theme'
import { TILE_SIZE } from './rowLayout'

const HALF = TILE_SIZE / 2
/** The letter fills three quarters of the square. */
const LETTER_SIZE = TILE_SIZE * 0.75
const LETTER_WEIGHT = 600
/** The square of an answer already taken, a grey instead of black. */
const DONE_COLOR = mixColor(PALETTE.black, PALETTE.white, 0.62)

/** A tick in the square, measured from the square's center as its nodes are. */
const TICK = new GfxPath()
  .moveTo(TILE_SIZE * -0.23, TILE_SIZE * 0.02)
  .lineTo(TILE_SIZE * -0.06, TILE_SIZE * 0.19)
  .lineTo(TILE_SIZE * 0.25, TILE_SIZE * -0.16)

class TickNode extends Node2D {
  constructor() {
    super('answer-tick')
  }

  override paint(gfx: Canvas): void {
    gfx.strokePath(TICK, {
      color: PALETTE.white,
      width: 6,
      join: 'miter',
    })
  }
}

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
  /** The square's color at rest, which the pose's red mixes toward. */
  readonly #base: string
  #x = 0
  #y = 0
  #drawnRadius = -1

  /** With `done`, the square is grey and holds a tick in place of the letter. */
  constructor(letter: string, done = false) {
    this.#base = done ? DONE_COLOR : PALETTE.black
    this.square = new ShapeNode({
      id: 'answer-square',
      geometry: {
        kind: 'rect',
        width: TILE_SIZE,
        height: TILE_SIZE,
        radii: 0,
      },
      fill: this.#base,
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
    this.tile.add(this.square)
    if (done) this.tile.add(new TickNode())
    else this.tile.add(this.letter)
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
    this.square.fill = mixColor(this.#base, PALETTE.red, p.red)
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

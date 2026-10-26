/**
 * One round's card as the scene holds it: the shape, the text clipped to it,
 * the fade at the bottom, and the line of result under it once the game is
 * over.
 *
 * The card never lays itself out. The scene gives it a keyframe each frame and
 * it sets its parts from that.
 */
import { Node2D } from 'stargazer'
import { cssColor } from '../game/contrast'
import { needsOutline } from '../game/outline'
import type { Round } from '../game/round'
import type { ContrastMessages } from '../i18n'
import { FadeNode } from './nodes/FadeNode'
import { CardNode } from './nodes/CardNode'
import { ManifestoNode } from './nodes/ManifestoNode'
import { ResultRowNode, type ResultRow } from './nodes/ResultRowNode'
import { ZOOM_SCALES, type Box, type CardKey } from './layout'

/** The space between a card in the strip and the line under it. */
const ROW_GAP = 12

export class RoundCard {
  readonly round: Round
  readonly root = new Node2D('round-card')
  readonly #card: CardNode
  readonly #content: ManifestoNode
  readonly #fade: FadeNode
  #row: ResultRowNode | null = null
  /** The card's text color, as the banner takes it over the card. */
  readonly ink: string

  /** 0 while the card is only an outline, 1 once it shows its colors. */
  reveal = 0

  /**
   * Whether the text keeps rasters at its rest and full screen scales ready,
   * which the card in play does so its zooms stay sharp.
   */
  warm = false

  constructor(round: Round, messages: ContrastMessages) {
    this.round = round
    const fill = cssColor(round.background)
    this.ink = cssColor(round.text)
    this.#card = new CardNode(fill, needsOutline(round.background))
    this.#content = new ManifestoNode(
      messages.manifesto.title,
      messages.manifesto.blocks,
      round.text,
    )
    this.#content.warmScales = ZOOM_SCALES
    this.#fade = new FadeNode(fill)
    this.root.add(this.#card, this.#content, this.#fade)
  }

  /** The box the card is in, once {@link place} has run. */
  box: Box = { x: 0, y: 0, width: 0, height: 0 }

  /**
   * Puts the card at `key`. `fade` is how much of the bottom fade shows and
   * `rowAlpha` how much of the line under it.
   */
  place(key: CardKey, fade: number, rowAlpha: number): void {
    const { box } = key
    this.box = box
    this.root.transform.x = box.x
    this.root.transform.y = box.y
    this.#card.setShape(box.width, box.height, key.radius)
    this.#card.reveal = this.reveal
    this.#card.zoom = fade
    this.#fade.setShape(box.width, box.height, key.radius)
    this.#fade.transform.alpha = fade
    this.#fade.visible = fade > 0.001

    const content = this.#content
    content.blend = this.reveal
    content.warmFrom = this.warm ? key.scale : 0
    content.transform.x = key.contentX
    content.transform.y = key.contentY
    content.transform.scaleX = key.scale
    content.transform.scaleY = key.scale
    // The text is clipped to the card, in the text's own scaled space.
    content.clip = {
      x: -key.contentX / key.scale,
      y: -key.contentY / key.scale,
      width: box.width / key.scale,
      height: box.height / key.scale,
    }

    const row = this.#row
    if (row) {
      row.transform.y = box.height + ROW_GAP
      row.transform.alpha = rowAlpha
      row.visible = rowAlpha > 0.001
    }
  }

  /** Adds the line under the card that says how the round went. */
  setResult(row: ResultRow, messages: ContrastMessages): void {
    if (this.#row) return
    this.#row = new ResultRowNode(row, messages.gameOver.butWas)
    this.#row.transform.alpha = 0
    this.root.add(this.#row)
  }

  destroy(): void {
    this.root.destroy()
  }
}

/**
 * A team's points readout in 2p — engine port of the `.vs__pts` block: a big
 * number over a small "PTS" label, both in the team's color, left-aligned. Two
 * `TextNode`s rather than one multi-line node, since the number and the label
 * render at different font sizes.
 */
import { Node2D, TextNode } from '@src/stargazer'

const FONT_FAMILY = 'system-ui, sans-serif'
const NUM_FONT_PX = 44.8 // 2.8rem
const LABEL_FONT_PX = 12.8 // 0.8rem
const LABEL_GAP_PX = 8 // space below the number, matching the original `.vs__pts` gap

export class VersusScoreNode extends Node2D {
  readonly #numNode: TextNode

  constructor(color: string, label: string) {
    super('jb-versus-score')
    this.#numNode = new TextNode({
      text: '0',
      fontFamily: FONT_FAMILY,
      fontWeight: 900,
      fontSize: NUM_FONT_PX,
      color,
      align: 'left',
      baseline: 'alphabetic',
    })
    const labelNode = new TextNode({
      text: label,
      y: LABEL_GAP_PX,
      fontFamily: FONT_FAMILY,
      fontWeight: 800,
      fontSize: LABEL_FONT_PX,
      color,
      align: 'left',
      baseline: 'top',
    })
    this.add(this.#numNode)
    this.add(labelNode)
  }

  setValue(value: number): void {
    this.#numNode.text = String(value)
  }
}

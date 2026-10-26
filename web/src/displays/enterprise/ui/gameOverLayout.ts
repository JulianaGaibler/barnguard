/**
 * Where the game over screen's parts sit: the banner, a row of three cards and
 * the buttons, as a stargazer layout bounded to the UI region so it centres on
 * any window shape.
 *
 * Each part is a fixed-size slot the layout positions, holding one child node
 * that the choreography moves, scales and fades. A relayout moves the slot and
 * never touches the child, so a resize in the middle of an animation keeps the
 * animation's own offsets. Every child pivots on its centre, so a scale pops in
 * place.
 */
import {
  Center,
  Column,
  LayoutRoot,
  Node2D,
  Padding,
  Row,
  SizedBox,
  edgeInsets,
  type Rect,
} from 'stargazer'

export const CARD_WIDTH = 392
export const CARD_HEIGHT = 516
const CARD_GAP = 38.4

/** The banner's slot is wide enough for the longest locale's text. */
export const BANNER_WIDTH = 900
export const BANNER_HEIGHT = 138
/** The button row's slot, wide enough for three buttons in any locale. */
export const BUTTONS_WIDTH = 1200
export const BUTTONS_HEIGHT = 80

/** Space between the banner and the cards, and the cards and the buttons. */
const BANNER_GAP = 91.5
const BUTTONS_GAP = 54.5
/**
 * The design's block sits 17 above the frame's centre. Padding the bottom by
 * twice that centres the padded block and lands the design block where it is.
 */
const LIFT = 34

export interface GameOverLayout {
  root: LayoutRoot
  banner: Node2D
  cards: readonly [Node2D, Node2D, Node2D]
  buttons: Node2D
}

/** A slot of the given size and the centre-pivoted child the animations own. */
function slot(
  id: string,
  width: number,
  height: number,
): {
  box: SizedBox
  child: Node2D
} {
  const box = new SizedBox({ width, height })
  const child = new Node2D(id)
  child.transform.originX = width / 2
  child.transform.originY = height / 2
  child.transform.x = width / 2
  child.transform.y = height / 2
  box.add(child)
  return { box, child }
}

export function buildGameOverLayout(bounds: () => Rect): GameOverLayout {
  const banner = slot('game-over-banner', BANNER_WIDTH, BANNER_HEIGHT)
  const cards = [0, 1, 2].map((i) =>
    slot(`game-over-card-${i}`, CARD_WIDTH, CARD_HEIGHT),
  )
  const buttons = slot('game-over-buttons', BUTTONS_WIDTH, BUTTONS_HEIGHT)

  const root = new LayoutRoot({ bounds, id: 'game-over-layout' })
  root.setContent(
    new Center({
      child: new Padding({
        insets: edgeInsets(0, 0, LIFT, 0),
        child: new Column({
          crossAxisAlign: 'center',
          children: [
            banner.box,
            new SizedBox({ width: 0, height: BANNER_GAP }),
            new Row({ gap: CARD_GAP, children: cards.map((c) => c.box) }),
            new SizedBox({ width: 0, height: BUTTONS_GAP }),
            buttons.box,
          ],
        }),
      }),
    }),
  )
  return {
    root,
    banner: banner.child,
    cards: [cards[0].child, cards[1].child, cards[2].child],
    buttons: buttons.child,
  }
}

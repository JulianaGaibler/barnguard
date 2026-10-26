/**
 * Where the print picker's parts sit: the name field, a row of three label
 * previews and the actions, as a stargazer layout bounded to the UI region. The
 * previews take the place and spacing of the game over cards, so the picker
 * reads as the same screen with its middle swapped.
 *
 * Each part is a fixed-size slot holding one centre-pivoted child that the
 * choreography moves, scales and fades, as in `gameOverLayout.ts`. The whole
 * layout hangs under `lift`, which moves the picker up while the keyboard is
 * open.
 */
import {
  Center,
  Column,
  LayoutRoot,
  Node2D,
  Row,
  SizedBox,
  type Rect,
} from 'stargazer'
import { BUTTONS_HEIGHT, BUTTONS_WIDTH } from './gameOverLayout'

export const NAME_FIELD_WIDTH = 600
export const NAME_FIELD_HEIGHT = 96
/** A preview is as wide as a game over card. */
export const PREVIEW_SIZE = 392
const PREVIEW_GAP = 38.4
const NAME_GAP = 64
const ACTIONS_GAP = 72

export const ACTIONS_WIDTH = BUTTONS_WIDTH
export const ACTIONS_HEIGHT = BUTTONS_HEIGHT

export interface PrintPickerLayout {
  /** Add this to the region. Its `transform.y` lifts the whole picker. */
  lift: Node2D
  root: LayoutRoot
  name: Node2D
  previews: readonly [Node2D, Node2D, Node2D]
  actions: Node2D
}

/** A slot of the given size and the centre-pivoted child the animations own. */
function slot(
  id: string,
  width: number,
  height: number,
): { box: SizedBox; child: Node2D } {
  const box = new SizedBox({ width, height })
  const child = new Node2D(id)
  child.transform.originX = width / 2
  child.transform.originY = height / 2
  child.transform.x = width / 2
  child.transform.y = height / 2
  box.add(child)
  return { box, child }
}

export function buildPrintPickerLayout(bounds: () => Rect): PrintPickerLayout {
  const name = slot('print-picker-name', NAME_FIELD_WIDTH, NAME_FIELD_HEIGHT)
  const previews = [0, 1, 2].map((i) =>
    slot(`print-picker-preview-${i}`, PREVIEW_SIZE, PREVIEW_SIZE),
  )
  const actions = slot('print-picker-actions', ACTIONS_WIDTH, ACTIONS_HEIGHT)

  const root = new LayoutRoot({ bounds, id: 'print-picker-layout' })
  root.setContent(
    new Center({
      child: new Column({
        crossAxisAlign: 'center',
        children: [
          name.box,
          new SizedBox({ width: 0, height: NAME_GAP }),
          new Row({ gap: PREVIEW_GAP, children: previews.map((p) => p.box) }),
          new SizedBox({ width: 0, height: ACTIONS_GAP }),
          actions.box,
        ],
      }),
    }),
  )
  const lift = new Node2D('print-picker-lift')
  lift.add(root)
  return {
    lift,
    root,
    name: name.child,
    previews: [previews[0].child, previews[1].child, previews[2].child],
    actions: actions.child,
  }
}

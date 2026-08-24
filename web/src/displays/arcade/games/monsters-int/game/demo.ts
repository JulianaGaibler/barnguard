/**
 * Tutorial card scenes, built on the shared demo stage.
 *
 * @remarks
 *   The first tutorial in the arcade to run in 3D, and it needs nothing from the
 *   stage to do it. `Stage.render` reads `SceneTree.has3D` every frame,
 *   attaches depth and builds a mesh renderer the moment a `Node3D` appears,
 *   and releases both when the last one goes. A card adds its own camera and is
 *   otherwise an ordinary demo.
 *
 *   Built from the game's own pieces: real `CardNode`s showing the real card art,
 *   the real `ButtonNode`, the poses out of `cardLayout`, the seat pills from
 *   `HudNode`, and `scorePlayer` for any number shown. Nothing here draws a
 *   card or works out a score for itself, so nothing here can disagree with the
 *   table about what a card looks like or what a hand is worth.
 *
 *   What is NOT shared is the choreography. Each card is hand-timed to the one
 *   sentence beside it, because a tutorial card gets a few seconds in a small
 *   4:3 panel while the table is paced for a 16:9 booth screen and a round that
 *   takes a minute. Each scene also takes the tightest window that holds what
 *   it is about, since the game's own framing leaves everything here too small
 *   to read.
 *
 *   No ground plane. The demo stage clears with `clearRect`, so leaving the table
 *   out lets the tutorial card's own surface show through instead of putting a
 *   slab of cream inside a panel that is already cream.
 * @example
 *   export const buildBustDemo: DemoBuilder = (stage) => ...
 */
import {
  ignoreAbort,
  Node2D,
  Node3D,
  type Rect,
  type Stage,
} from '@src/stargazer'
import { FingerHintNode } from '@src/displays/arcade/tutorial/FingerHintNode'
import type {
  DemoBuilder,
  DemoHandle,
} from '@src/displays/arcade/tutorial/types'
import {
  loadCardTextures,
  CARD_BACK,
  type CardTextures,
} from './art/cardTextures'
import { loadMouthTexture, loadWordArt } from './art/tableTextures'
import { focusPose, mouthPose, REVEAL, revealPose } from './cardLayout'
import { ButtonNode } from './nodes/ButtonNode'
import { CameraRigNode, focalFor } from './nodes/CameraRigNode'
import { CardNode, type CardPose } from './nodes/CardNode'
import { HudNode } from './nodes/HudNode'
import { createMouthNode, createWordNode } from './nodes/TableNode'
import { groundFromLayout, PX_TO_M } from './project'
import { faceOf, type Card, type DeckCard } from './rules/cards'
import { createPlayer, scorePlayer, type PlayerState } from './rules/player'
import { freeze, life, n, plus, threeMore, x2 } from './rules/scriptedDeck'

import { ANIM, BUTTONS, CARD, COLORS, FOCUS, seatName } from './tuning'
import { REGION_HEIGHT, REGION_WIDTH } from '../../../world'

/**
 * The demo stage's fixed world rect, and the fallback if it has no camera yet.
 * The stage always has one, but the type allows null and a default rect is a
 * better failure than a builder that throws.
 */
function demoView(stage: Stage): Rect {
  return (
    stage.currentCamera2D?.viewport ?? { x: 0, y: 0, width: 1000, height: 750 }
  )
}

/** A scene built from the game's own furniture, framed on one part of the table. */
export interface Bench {
  /** The 3D world: everything standing on the table, and the camera over it. */
  world: Node3D
  /**
   * Drawn over the 3D pass, and placed so its children work in the SAME design
   * coordinates the table does. That is what lets `HudNode` and the finger cue
   * be dropped in against table positions with no conversion.
   */
  overlay: Node2D
  /** The part of the design space on screen, for anything anchored to an edge. */
  frame: Rect
  destroy(): void
}

/**
 * Build a scene showing `designHeight` pixels of the design space, centred on
 * `(centerX, centerY)`.
 *
 * `designHeight` is how far to stand back. At the demo viewport's own height
 * the table is at its drawn size, and larger zooms out. The overlay is scaled
 * to match, so design coordinates keep landing in the right place either way.
 */
export function bench(
  stage: Stage,
  centerX: number,
  centerY: number,
  designHeight: number,
): Bench {
  const view = demoView(stage)
  const width = designHeight * (view.width / view.height)
  const frame: Rect = {
    x: centerX - width / 2,
    y: centerY - designHeight / 2,
    width,
    height: designHeight,
  }

  const world = new Node3D('mi-demo-world')
  stage.tree.root.add(world)
  // The rig already knows how to frame an arbitrary rect of the design space:
  // it takes a live viewport and turns it into a camera offset. A fixed one
  // points it at whichever part of the table this card is about.
  // Standing back at the table's own distance rather than at this crop's.
  // Otherwise a close frame puts the eye nearer the table than the foreground
  // is, and every held-up card is clipped away behind it.
  const rig = new CameraRigNode(
    { viewport: frame },
    frame.height,
    focalFor(REGION_HEIGHT),
  )
  world.add(rig)
  rig.makeCurrent()

  const overlay = new Node2D('mi-demo-overlay')
  overlay.renderLayer = 'dynamic'
  const scale = view.height / frame.height
  overlay.transform.scaleX = scale
  overlay.transform.scaleY = scale
  overlay.transform.x = view.x - frame.x * scale
  overlay.transform.y = view.y - frame.y * scale
  stage.tree.root.add(overlay)

  return {
    world,
    overlay,
    frame,
    destroy() {
      if (!world.isDestroyed) world.destroy()
      if (!overlay.isDestroyed) overlay.destroy()
    },
  }
}

/**
 * Run a card's loop until it is scrolled away.
 *
 * Every wait inside is scoped to a node of the scene, so destroying the scene
 * aborts the chain rather than leaving it running against a dead table.
 */
function play(body: () => Promise<void>): void {
  void body().catch(ignoreAbort)
}

/** The mouth, and the lettering for the one card that shows the buttons. */
function addMouth(b: Bench, words = false): void {
  void Promise.all([
    loadMouthTexture(),
    words ? loadWordArt('HIT', COLORS.ink) : null,
    words ? loadWordArt('STAY', COLORS.ink) : null,
  ])
    .then(([mouth, hit, stay]) => {
      if (b.world.isDestroyed) return
      b.world.add(createMouthNode(mouth))
      if (!hit || !stay) return
      b.world.add(
        createWordNode(
          hit,
          BUTTONS.labelLeftX,
          BUTTONS.labelY,
          BUTTONS.labelHeight,
        ),
        createWordNode(
          stay,
          BUTTONS.labelRightX,
          BUTTONS.labelY,
          BUTTONS.labelHeight,
        ),
      )
    })
    .catch(() => {})
}

/**
 * A hand of cards that can be dealt into and read.
 *
 * Cards come out of the mouth and lay themselves across the top of the frame in
 * the game's own focus row, which is where a hand being decided on sits, and
 * the pill above it is the game's own. What the hand is worth comes from
 * `scorePlayer`, so a card that shows a total shows the total the table would.
 */
class DemoHand {
  readonly #b: Bench
  readonly #textures: CardTextures
  readonly #hud: HudNode
  readonly #player: PlayerState = createPlayer(0)
  readonly #nodes = new Map<string, CardNode>()
  #dealt = 0

  constructor(b: Bench, textures: CardTextures, hud: HudNode) {
    this.#b = b
    this.#textures = textures
    this.#hud = hud
  }

  /**
   * Put cards straight into the hand with no dealing.
   *
   * For a card whose point is at the END of a run. Watching seven arrive one at
   * a time spends the whole of a tutorial card on the boring part, so the hand
   * starts most of the way there and only the cards that matter are dealt.
   */
  preset(cards: readonly Card[]): void {
    for (const card of cards) {
      const held: DeckCard = { id: `demo-${this.#dealt++}`, card }
      const node = new CardNode(held.id)
      node.setFace(this.#textures[faceOf(card)]!, this.#textures[CARD_BACK]!)
      this.#b.world.add(node)
      this.#nodes.set(held.id, node)
      if (card.kind === 'number') this.#player.numbers.push(held)
      else this.#player.modifiers.push(held)
    }
    const all = [...this.#player.numbers, ...this.#player.modifiers]
    all.forEach((c, i) =>
      this.#nodes.get(c.id)?.snapTo(focusPose(i, all.length)),
    )
    this.sync()
  }

  /** Bring a card up out of the mouth and lay it into the hand. */
  async deal(card: Card, hold = 0.9): Promise<void> {
    const held: DeckCard = { id: `demo-${this.#dealt++}`, card }
    const node = new CardNode(held.id)
    node.setFace(this.#textures[faceOf(card)]!, this.#textures[CARD_BACK]!)
    this.#b.world.add(node)
    this.#nodes.set(held.id, node)
    node.snapTo(mouthPose())
    node.moveTo(revealPose())
    await this.#b.overlay.wait(hold)

    if (card.kind === 'number') this.#player.numbers.push(held)
    else this.#player.modifiers.push(held)
    this.#layout()
    this.sync()
    await this.#b.overlay.wait(ANIM.move)
  }

  /** Hold a card up at the reveal without taking it, for one about to be read. */
  async show(card: Card, hold: number): Promise<CardNode> {
    const node = new CardNode(`demo-show-${this.#dealt++}`)
    node.setFace(this.#textures[faceOf(card)]!, this.#textures[CARD_BACK]!)
    this.#b.world.add(node)
    node.snapTo(mouthPose())
    node.moveTo(revealPose())
    await this.#b.overlay.wait(hold)
    return node
  }

  /** Wash the whole hand out, for the seat that just went out of the round. */
  bust(): void {
    for (const node of this.#nodes.values()) node.setDimmed(true)
    this.#player.status = 'busted'
    this.sync()
  }

  /** Turn every card in the row, in a wave, the way a finished set does. */
  celebrate(stagger: number, duration: number): void {
    let i = 0
    for (const node of this.#nodes.values())
      node.spin(1, duration, i++ * stagger)
  }

  sync(): void {
    this.#hud.setSeats([
      {
        seat: 0,
        label: seatName(0),
        total: 0,
        round:
          this.#player.status === 'busted'
            ? null
            : scorePlayer(this.#player).total,
        status: this.#player.status,
        up: this.#player.status === 'active',
      },
    ])
    this.#hud.setFocusedSeat(0)
  }

  clear(): void {
    for (const node of this.#nodes.values()) node.destroy()
    this.#nodes.clear()
    this.#player.numbers.length = 0
    this.#player.modifiers.length = 0
    this.#player.status = 'active'
    this.sync()
  }

  /**
   * Re-place the whole hand, exactly as the table does for a lifted one.
   *
   * Numbers and bonuses in one row. The table only tucks bonuses under a seat
   * while that hand is DOWN, and a hand held up carries them along with it, so
   * placing them at their seat here would send them off the side of a frame
   * cropped to the middle of the table.
   */
  #layout(): void {
    const all = [...this.#player.numbers, ...this.#player.modifiers]
    all.forEach((c, i) => {
      this.#nodes
        .get(c.id)
        ?.moveTo(focusPose(i, all.length), ANIM.move, i * ANIM.stagger)
    })
  }
}

/** A scene with a hand in it, once the card art has decoded. */
function withHand(
  b: Bench,
  run: (hand: DemoHand) => Promise<void>,
): DemoHandle {
  const hud = new HudNode()
  hud.setSeatCount(2)
  hud.setViewport(b.frame)
  hud.visible = true
  b.overlay.add(hud)

  void loadCardTextures().then((textures) => {
    if (b.world.isDestroyed) return
    play(() => run(new DemoHand(b, textures, hud)))
  })
  return { destroy: () => b.destroy() }
}

/**
 * Where a card that shows a hand is framed.
 *
 * From the seat's pill, which rides above the row, down to the foot of the card
 * standing at the reveal. The pill is the top of the content and not the row,
 * so a frame measured from the cards alone cuts it in half.
 */
const HAND_CENTER_Y = 410
const HAND_ZOOM = 580
/** A row of seven is wider than anything else the tutorial shows. */
const WIDE_ZOOM = 720

// --- the cards --------------------------------------------------------------

/** A round is worth what its numbers add up to, and 200 of them wins a match. */
export const buildGoalDemo: DemoBuilder = (stage): DemoHandle => {
  const b = bench(stage, FOCUS.centerX, HAND_CENTER_Y, HAND_ZOOM)
  addMouth(b)
  return withHand(b, async (hand) => {
    for (;;) {
      hand.sync()
      for (const value of [3, 9, 11]) await hand.deal(n(value))
      await b.overlay.wait(2.6)
      hand.clear()
      await b.overlay.wait(0.5)
    }
  })
}

/** Seven distinct numbers ends the round for everyone, and pays a bonus. */
export const buildSevenDemo: DemoBuilder = (stage): DemoHandle => {
  const b = bench(stage, FOCUS.centerX, HAND_CENTER_Y, WIDE_ZOOM)
  addMouth(b)
  return withHand(b, async (hand) => {
    for (;;) {
      // Most of the way there already. The lesson is the set completing, and
      // watching the first five arrive spends the card on the part that is not
      // the point.
      hand.preset([4, 9, 1, 11, 6].map(n))
      await b.overlay.wait(0.8)
      for (const value of [2, 8]) await hand.deal(n(value))
      hand.celebrate(0.09, 0.5)
      await b.overlay.wait(4.2)
      hand.clear()
      await b.overlay.wait(0.5)
    }
  })
}

/** The same number twice and the round is over for you, with nothing to show. */
export const buildBustDemo: DemoBuilder = (stage): DemoHandle => {
  const b = bench(stage, FOCUS.centerX, HAND_CENTER_Y, HAND_ZOOM)
  addMouth(b)
  return withHand(b, async (hand) => {
    for (;;) {
      // The hand is already going well, which is what makes the repeat land.
      hand.preset([3, 7, 9, 4].map(n))
      await b.overlay.wait(0.8)
      // The repeat stays at the reveal and turns, so it reads as a 7 arriving
      // next to a 7 rather than as one more card joining the row.
      const repeat = await hand.show(n(7), 1)
      repeat.spin(1, 0.5)
      await b.overlay.wait(0.7)
      hand.bust()
      await b.overlay.wait(3.2)
      repeat.destroy()
      hand.clear()
      await b.overlay.wait(0.5)
    }
  })
}

/** The pluses add on, and the doubler doubles the numbers before they do. */
export const buildBonusDemo: DemoBuilder = (stage): DemoHandle => {
  const b = bench(stage, FOCUS.centerX, HAND_CENTER_Y, HAND_ZOOM)
  addMouth(b)
  return withHand(b, async (hand) => {
    for (;;) {
      hand.sync()
      for (const value of [5, 8]) await hand.deal(n(value))
      // The two bonuses last, one after the other, so the total moves twice and
      // the doubler is visibly the bigger of the two moves.
      await hand.deal(plus(6), 1.2)
      await hand.deal(x2, 1.2)
      await b.overlay.wait(2.6)
      hand.clear()
      await b.overlay.wait(0.5)
    }
  })
}

/** Enough of the census to make the point: one against twelve. */
const DECK_COLUMNS = [1, 2, 3, 12]
const DECK_ZOOM = 620
const DECK_STEP = 230
/** How far a card in a stack peeks out past the one in front of it. */
const DECK_OVERLAP = 40
/** Where the shortest stack rests, with the taller ones climbing away from it. */
const DECK_BASE_Y = REGION_HEIGHT / 2 + 200

/**
 * The deck: one 1, two 2s, and so on to twelve 12s.
 *
 * Four columns rather than all twelve. At this size a full census is a wall of
 * cards nobody counts, and one against twelve says it at a glance.
 */
export const buildDeckDemo: DemoBuilder = (stage): DemoHandle => {
  const tallest = (Math.max(...DECK_COLUMNS) - 1) * DECK_OVERLAP
  const b = bench(stage, REGION_WIDTH / 2, DECK_BASE_Y - tallest / 2, DECK_ZOOM)

  void loadCardTextures().then((faces) => {
    if (b.world.isDestroyed) return
    DECK_COLUMNS.forEach((value, column) => {
      const x =
        REGION_WIDTH / 2 + (column - (DECK_COLUMNS.length - 1) / 2) * DECK_STEP
      for (let copy = 0; copy < value; copy++) {
        const card = new CardNode(`mi-deck-${value}-${copy}`)
        card.setFace(faces[faceOf(n(value))]!, faces[CARD_BACK]!)
        b.world.add(card)
        // Overlapped up the screen, so a column's HEIGHT is its count and every
        // card in it still shows its face.
        const at = groundFromLayout(x, DECK_BASE_Y - copy * DECK_OVERLAP)
        card.snapTo({
          x: at.x,
          y: (copy + 1) * CARD.lift * PX_TO_M,
          z: at.z,
          facing: 'flat',
        })
      }
    })
  })

  return { destroy: () => b.destroy() }
}

/** The buttons and the mouth under them, and nothing else. */
const HIT_STAY_CENTER_Y = 700
const HIT_STAY_ZOOM = 620

/**
 * Hit or stay: the only thing a player ever does.
 *
 * The card arrives first and then both buttons go down in turn, because the
 * sentence is about a choice: what the buttons do only means anything once
 * there is a card on the table to do it about.
 *
 * The real buttons, pressed through `setPressed`, since the demo stage takes no
 * input and a drawn copy of a button is a copy free to drift from the real
 * one.
 */
export const buildHitStayDemo: DemoBuilder = (stage): DemoHandle => {
  const b = bench(
    stage,
    (BUTTONS.leftX + BUTTONS.rightX) / 2,
    HIT_STAY_CENTER_Y,
    HIT_STAY_ZOOM,
  )
  addMouth(b, true)

  const hit = new ButtonNode(BUTTONS.leftX, () => {}, 'mi-demo-hit')
  const stay = new ButtonNode(BUTTONS.rightX, () => {}, 'mi-demo-stay')
  b.world.add(hit, stay)

  const finger = new FingerHintNode()
  b.overlay.add(finger)

  const card = new CardNode('mi-demo-card')
  b.world.add(card)
  card.visible = false
  void loadCardTextures().then((faces) => {
    if (card.isDestroyed) return
    card.setFace(faces[faceOf(n(8))]!, faces[CARD_BACK]!)
  })

  /** Move the finger onto a button, press it, and let go. */
  async function tap(button: ButtonNode, layoutX: number): Promise<void> {
    finger.transform.x = layoutX
    finger.transform.y = BUTTONS.groundY - BUTTONS.capRiseOnScreen
    await finger.tween({ alpha: 1 }, { duration: 0.22 })
    button.setPressed(true)
    await finger.wait(0.4)
    button.setPressed(false)
    await finger.tween({ alpha: 0 }, { duration: 0.22 })
  }

  play(async () => {
    for (;;) {
      // The card first: the two buttons are a choice about it, and pressing
      // them over an empty table is a choice about nothing.
      card.visible = true
      card.snapTo(mouthPose())
      card.moveTo(revealPose())
      await b.overlay.wait(1.3)
      await tap(hit, BUTTONS.leftX)
      await b.overlay.wait(0.5)
      await tap(stay, BUTTONS.rightX)
      await b.overlay.wait(0.8)
      card.visible = false
      await b.overlay.wait(0.6)
    }
  })

  return { destroy: () => b.destroy() }
}

/** How the three rule-changing cards are laid out, and the beat between lifts. */
const ACTIONS_ZOOM = 560
const ACTION_LIFT = 26
const ACTION_BEAT = 1.1
const ACTION_FACES: readonly Card[] = [freeze, threeMore, life]

/**
 * The three cards that change the rules, side by side.
 *
 * Presented rather than played. Each of them does something to somebody else
 * over several seconds, and three of those inside the few seconds a card is
 * looked at is a blur. Shown together, with each lifting in turn, they can be
 * read here and recognised later on the table.
 */
export const buildActionsDemo: DemoBuilder = (stage): DemoHandle => {
  const b = bench(stage, FOCUS.centerX, REVEAL.y, ACTIONS_ZOOM)
  const cards: CardNode[] = []

  void loadCardTextures().then((textures) => {
    if (b.world.isDestroyed) return
    ACTION_FACES.forEach((card, i) => {
      const node = new CardNode(`mi-action-${i}`)
      node.setFace(textures[faceOf(card)]!, textures[CARD_BACK]!)
      b.world.add(node)
      node.snapTo(revealPose(i, ACTION_FACES.length))
      cards.push(node)
    })
    play(loop)
  })

  /**
   * Lift each in turn, so the eye is walked along them rather than left to
   * pick.
   */
  async function loop(): Promise<void> {
    for (let i = 0; ; i = (i + 1) % ACTION_FACES.length) {
      const node = cards[i]
      if (!node) return
      const rest: CardPose = revealPose(i, ACTION_FACES.length)
      node.moveTo({ ...rest, y: rest.y + ACTION_LIFT * PX_TO_M })
      await b.overlay.wait(ACTION_BEAT)
      node.moveTo(rest)
      await b.overlay.wait(ACTION_BEAT * 0.5)
    }
  }

  return { destroy: () => b.destroy() }
}

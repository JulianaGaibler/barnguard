// The scenes behind the how-to-play cards.
//
// Every one is built from the game's own pieces: real cards off a real deal,
// the same `CardNode` the board draws, the same `cardFace` geometry it draws
// with, and the real scoring for the card that adds a match up. A tutorial that
// restates the rules in its own numbers is one that goes quietly wrong the
// first time the rules move.
//
// The demo stage hands out a fixed 4:3 viewport where the board is 16:9, so
// these compose their own rects rather than calling `computeTable`. Nothing
// here reaches into a session: there is no match being played, only a state
// object to read cards out of.

import {
  Behavior,
  Node2D,
  ShapeNode,
  TextNode,
  easings,
  ignoreAbort,
  // A local `rect` in the close-up builders holds the card's own box.
  rect as rectangle,
  rectCopy,
  rectInflate,
  rectUnion,
  type Rect,
  type Stage,
} from '@src/stargazer'
import { FingerHintNode } from '@src/displays/arcade/tutorial/FingerHintNode'
import type {
  DemoBuilder,
  DemoHandle,
} from '@src/displays/arcade/tutorial/types'
import { CardNode } from './nodes/CardNode'
import { ElevatorNode } from './nodes/ElevatorNode'
import { ResourceBarNode } from './nodes/ResourceBarNode'
import { cardFace } from './cardFace'
import { shortlistSlots, windowCellRect } from './layout'
import { createMatch, settleSide, type Side } from './rules/match'
import { DECK, type Card } from './rules/deck'
import { COLORS, LAYOUT } from './tuning'
import { textFamily } from '../fonts'
import { loadIcons } from '../art/icons'

/** The stage's own rect, or the size it is documented to hand out. */
function viewportOf(stage: Stage): Rect {
  return (
    stage.currentCamera2D?.viewport ?? { x: 0, y: 0, width: 1000, height: 750 }
  )
}

/**
 * The cards these scenes are built from.
 *
 * Named rather than taken off the top of a deal, because three of the seven
 * cards point at parts of a card face and would say nothing on a card that
 * happens to be blank there. `demo.test.ts` holds them to it.
 */
export const DEMO_CARD_IDS = {
  /** Two departments, a price, and an elevator. Card 3 points at all three. */
  anatomy: 'mgmt-chief-of-staff',
  /** A full org, for the reveal that adds one up. */
  org: [
    'mgmt-ceo',
    'ic-icon-designer',
    'mgmt-chief-operating-officer',
    'ic-ux-lead',
    'mgmt-head-of-product',
    'ic-content-designer',
    'mgmt-general-counsel',
    'ic-staff-researcher',
    'ic-director-of-ux',
  ],
} as const

const cardById = (id: string): Card => DECK.find((c) => c.id === id) ?? DECK[0]!

/**
 * Populate `root` once the artwork has rasterised.
 *
 * `DemoBuilder` is synchronous and a `CardNode` drawn before `loadIcons`
 * resolves has no badges, no coin and no glyphs on its rules text. The scene
 * therefore arrives a frame or two late rather than arriving wrong. The guard
 * matters because the stage destroys a demo's subtree the moment the carousel
 * moves on, which can be before this resolves.
 */
function whenReady(root: Node2D, fill: () => void): void {
  void loadIcons()
    .then(() => {
      if (!root.isDestroyed) fill()
    })
    .catch(ignoreAbort)
}

const handleFor = (root: Node2D): DemoHandle => ({
  destroy() {
    if (!root.isDestroyed) root.destroy()
  },
})

/** A card node showing `card`, parked at `rect`. */
function placeCard(parent: Node2D, card: Card, rect: Rect): CardNode {
  const node = new CardNode(`demo-${card.id}`)
  parent.add(node)
  node.setFace({ kind: 'card', card, budget: 0 })
  node.setHome(rect)
  node.snapHome()
  return node
}

/**
 * A ring around part of a card, for the scenes that point at one.
 *
 * The stroke is in world units and sized off the card, so it thickens with the
 * close-up instead of thinning to a hair as the frame scales up.
 */
function highlight(parent: Node2D, rect: Rect, lineWidth: number): ShapeNode {
  const ring = new ShapeNode({
    id: 'demo-highlight',
    geometry: {
      kind: 'rect',
      width: rect.width,
      height: rect.height,
      centered: false,
      radii: Math.min(rect.height / 2, rect.width * 0.06),
    },
    stroke: COLORS.activeSide,
    lineWidth,
    strokeSpace: 'world',
  })
  ring.transform.x = rect.x
  ring.transform.y = rect.y
  ring.transform.alpha = 0
  parent.add(ring)
  return ring
}

function label(parent: Node2D, text: string, x: number, y: number): TextNode {
  const node = new TextNode({
    text,
    x,
    y,
    fontFamily: textFamily,
    fontWeight: 700,
    fontSize: 26,
    sizeSpace: 'world',
    color: COLORS.ink,
    align: 'center',
    baseline: 'middle',
  })
  parent.add(node)
  return node
}

// Card 1. Three hires joining an org.

/**
 * Where the three dragged cards land, in the order they are dragged.
 *
 * Up the left edge and then a step right, so the org comes out an L rather than
 * a filled row. A row would say seats are taken in order, which is the one
 * thing about placement that is not true: a hire goes anywhere it touches what
 * is already there.
 */
export const HIRE_PATH: readonly { r: number; c: number }[] = [
  { r: 1, c: 0 },
  { r: 0, c: 0 },
  { r: 0, c: 1 },
]

/** The seat already taken when the scene opens, which the L grows out of. */
export const HIRE_ANCHOR = { r: 2, c: 0 } as const

export const buildHireDemo: DemoBuilder = (stage) => {
  const view = viewportOf(stage)
  const root = new Node2D('demo-hire')
  stage.tree.root.add(root)

  whenReady(root, () => {
    const match = createMatch(7)

    // One card width for the whole scene, because a shortlist card and an org
    // cell are the same size on the real board. The gap is wider than the
    // board's, where the two grids are read at arm's length rather than across
    // a room.
    const pad = view.width * 0.04
    const cardGap = 0.18
    const span = 3 + 2 * cardGap
    const byWidth = (view.width - pad * 3) / (2 * span)
    const byHeight =
      (view.height - pad * 2) / (3 * LAYOUT.cardAspect + 2 * cardGap)
    const w = Math.min(byWidth, byHeight)
    const cardH = w * LAYOUT.cardAspect
    const gridW = w * span
    const gridH = 3 * cardH + 2 * w * cardGap

    /** Seat `r, c` of a grid whose top left corner is `x, y`. */
    const cell = (x: number, y: number, r: number, c: number): Rect => ({
      x: x + c * w * (1 + cardGap),
      y: y + r * (cardH + w * cardGap),
      width: w,
      height: cardH,
    })

    const orgX = view.width - pad - gridW
    const orgY = (view.height - gridH) / 2
    const deckX = pad
    // Both shortlists, because a player picks from a board of six and showing
    // one row would leave the other floor to be a surprise.
    const deckY = (view.height - (2 * cardH + w * cardGap)) / 2

    // The lower shortlist just sits there. Only one floor is open on a turn,
    // and a card leaving both rows would say otherwise.
    match.shortlists.ic.forEach((card, i) => {
      if (card) placeCard(root, card, cell(deckX, deckY, 1, i))
    })

    const anchor = match.shortlists.ic[0]
    if (anchor) {
      placeCard(root, anchor, cell(orgX, orgY, HIRE_ANCHOR.r, HIRE_ANCHOR.c))
    }

    const finger = new FingerHintNode()
    root.add(finger)
    finger.visible = true
    finger.transform.alpha = 0

    /** Everything one pass of the loop builds, cleared before the next. */
    const pass: CardNode[] = []
    const clearPass = (): void => {
      for (const node of pass) if (!node.isDestroyed) node.destroy()
      pass.length = 0
    }

    root.loop(async ({ node, signal }) => {
      clearPass()
      const runs = HIRE_PATH.map((seat, i) => ({
        seat,
        from: cell(deckX, deckY, 0, i),
        card: match.shortlists.management[i],
        refill: match.decks.management[i],
      })).filter((run) => run.card)

      for (const run of runs) {
        pass.push(placeCard(root, run.card!, run.from))
      }
      await node.wait(0.6, signal)

      for (const [i, run] of runs.entries()) {
        const held = pass[i]!
        const to = cell(orgX, orgY, run.seat.r, run.seat.c)
        // Re-adding moves the card to the end of the draw order, so the one
        // being carried passes over the cards it crosses rather than under.
        root.add(held)
        // The hand rides the card it is moving, so one tween carries both.
        held.add(finger)
        finger.transform.x = run.from.width * 0.5
        finger.transform.y = run.from.height * 0.5
        await finger.tween(
          { alpha: 1 },
          { duration: 0.16, easing: easings.outCubic },
        )
        held.setHome(to)
        await held.tween(
          { x: to.x, y: to.y },
          { duration: 0.55, easing: easings.inOutCubic },
        )
        await finger.tween({ alpha: 0 }, { duration: 0.14 })
        // The hole fills behind the hire, as it does on the board. Not awaited,
        // so the next drag starts while this one is still arriving.
        if (run.refill) {
          const fresh = placeCard(root, run.refill, run.from)
          pass.push(fresh)
          fresh.appear(0)
        }
        await node.wait(0.2, signal)
      }
      await node.wait(1.6, signal)
    })
  })

  return handleFor(root)
}

// Card 2. The elevator deciding which shortlist is live.

export const buildFloorsDemo: DemoBuilder = (stage) => {
  const view = viewportOf(stage)
  const root = new Node2D('demo-floors')
  stage.tree.root.add(root)

  whenReady(root, () => {
    const match = createMatch(11)
    const rowH = view.height * 0.32
    const rowW = view.width * 0.62
    const left = view.width * 0.3
    const rows: Rect[] = [
      { x: left, y: view.height * 0.1, width: rowW, height: rowH },
      { x: left, y: view.height * 0.58, width: rowW, height: rowH },
    ]

    const cards: CardNode[][] = rows.map((row, floorIndex) => {
      const floor = floorIndex === 0 ? 'management' : 'ic'
      const slots = shortlistSlots(row)
      return slots.flatMap((slot, i) => {
        const card = match.shortlists[floor][i]
        return card ? [placeCard(root, card, slot)] : []
      })
    })

    const shaftW = view.width * 0.08
    const lift = new ElevatorNode('demo-lift')
    root.add(lift)
    lift.setGeom(
      {
        x: left - shaftW * 1.6,
        y: rows[0]!.y,
        width: shaftW,
        height: rows[1]!.y + rowH - rows[0]!.y,
      },
      rows[0]!.y + rowH / 2,
      rows[1]!.y + rowH / 2,
    )

    const show = (live: 0 | 1): void => {
      cards.forEach((rowCards, i) => {
        for (const node of rowCards) node.setFaded(i !== live)
      })
      lift.goTo(live === 0 ? 'management' : 'ic', true)
    }
    show(0)

    root.loop(async ({ node, signal }) => {
      await node.wait(1.6, signal)
      show(1)
      await node.wait(1.6, signal)
      show(0)
    })
  })

  return handleFor(root)
}

// Cards 3, 5 and 6. Parts of a card face, shown whole and then closed in on.

/** The whole card, centred and as tall as the frame allows. */
function fittedCard(view: Rect): Rect {
  const height = view.height * 0.88
  const width = height / LAYOUT.cardAspect
  return {
    x: view.width / 2 - width / 2,
    y: view.height / 2 - height / 2,
    width,
    height,
  }
}

/** The smallest rect covering all of `rects`, grown by `pad`. */
function union(rects: readonly Rect[], pad: number): Rect {
  const box = rects.reduce(
    (acc, r) => rectUnion(acc, acc, r),
    rectCopy(rectangle(), rects[0]!),
  )
  return rectInflate(box, box, pad)
}

/**
 * The transform that brings `target` to the middle of the frame, filling `fill`
 * of its height.
 *
 * `target` is in the same space the card is placed in, so the scenes measure
 * against `cardFace` and never against the viewport. Scaling the container
 * rather than resizing the card is what keeps the rules text laid out for the
 * size it started at instead of reflowing as the zoom runs.
 */
function closeUpOn(
  view: Rect,
  target: Rect,
  fill: number,
): { x: number; y: number; scaleX: number; scaleY: number } {
  const k = (view.height * fill) / target.height
  const cx = target.x + target.width / 2
  const cy = target.y + target.height / 2
  return {
    scaleX: k,
    scaleY: k,
    x: view.width / 2 - k * cx,
    y: view.height / 2 - k * cy,
  }
}

/**
 * Show the whole card, close in on part of it, then ring what is being talked
 * about.
 *
 * `parts` are in card-local coordinates, which is what `cardFace` hands out.
 */
function buildCloseUp(
  id: string,
  parts: (g: ReturnType<typeof cardFace>) => Rect[],
  fill: number,
): DemoBuilder {
  return (stage) => {
    const view = viewportOf(stage)
    const root = new Node2D(`demo-closeup-${id}`)
    stage.tree.root.add(root)

    whenReady(root, () => {
      // The frame is what moves. The card sits still inside it.
      const frame = new Node2D('frame')
      root.add(frame)

      const card = cardById(DEMO_CARD_IDS.anatomy)
      const rect = fittedCard(view)
      placeCard(frame, card, rect)

      const g = cardFace(rect.width, rect.height)
      const pad = rect.width * 0.025
      const marks = parts(g).map((r) =>
        rectInflate(
          rectangle(),
          { ...r, x: rect.x + r.x, y: rect.y + r.y },
          pad,
        ),
      )
      const rings = marks.map((r) => highlight(frame, r, rect.width * 0.012))

      const to = closeUpOn(view, union(marks, pad), fill)
      void frame
        .tween(to, {
          duration: 0.9,
          delay: 0.7,
          easing: easings.inOutCubic,
        })
        .then(() => revealInTurn(rings))
        .catch(ignoreAbort)
    })

    return handleFor(root)
  }
}

export const buildAnatomyDemo: DemoBuilder = buildCloseUp(
  'anatomy',
  (g) => [
    {
      x: g.coin.cx - g.coin.r,
      y: g.coin.cy - g.coin.r,
      width: g.coin.r * 2,
      height: g.coin.r * 2,
    },
    g.elevator,
    {
      x: g.badgeX,
      y: g.badgeFirstY,
      width: g.badgeSize,
      height: g.badgeStepY + g.badgeSize,
    },
  ],
  0.6,
)

export const buildOnHireDemo = buildCloseUp('on-hire', (g) => [g.onHire], 0.34)
export const buildReviewDemo = buildCloseUp(
  'review',
  (g) => [g.reviewBand],
  0.3,
)

// Card 4. What the two currencies are for.

export const buildResourcesDemo: DemoBuilder = (stage) => {
  const view = viewportOf(stage)
  const root = new Node2D('demo-resources')
  stage.tree.root.add(root)

  whenReady(root, () => {
    const bar = new ResourceBarNode('demo-bar')
    root.add(bar)
    const w = view.width * 0.7
    const h = view.height * 0.16
    bar.setSize(w, h)
    bar.transform.x = (view.width - w) / 2
    bar.transform.y = view.height / 2 - h / 2
    bar.setLabel('You')
    bar.setValues(4, 12)
    bar.setActive(true)
  })

  return handleFor(root)
}

// Card 7. A finished org adding itself up.

export const buildScoreDemo: DemoBuilder = (stage) => {
  const view = viewportOf(stage)
  const root = new Node2D('demo-score')
  stage.tree.root.add(root)

  whenReady(root, () => {
    const side = demoOrg()
    const result = settleSide(side)
    const gridSide = Math.min(view.width * 0.55, view.height * 0.86)
    const org: Rect = {
      x: view.width * 0.06,
      y: (view.height - gridSide) / 2,
      width: gridSide,
      height: gridSide,
    }

    const seats: { node: CardNode; points: number }[] = []
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        const cell = result.grid[r]?.[c]
        if (!cell || !('card' in cell)) continue
        const entry = result.breakdown.seats[r * 3 + c]
        const node = placeCard(root, cell.card, windowCellRect(org, 3, 3, r, c))
        seats.push({ node, points: entry?.points ?? 0 })
      }
    }

    const totalX = view.width * 0.8
    const caption = label(root, 'Total', totalX, view.height * 0.42)
    caption.fontSize = 28
    caption.color = COLORS.inkSoft
    const total = label(root, '0', totalX, view.height * 0.55)
    total.fontSize = 84
    total.color = COLORS.activeSide

    root.addBehavior(new ScoreReveal(seats, total, result.breakdown.total))
  })

  return handleFor(root)
}

/**
 * A worked org, dealt by hand so the reveal has something worth adding up.
 *
 * The nine cards are real and the total is not written down anywhere: the scene
 * runs them through `settleSide`, so the figures on the card are the figures
 * the game would award.
 */
function demoOrg(): Side {
  const grid = Array.from({ length: 5 }, () =>
    Array.from({ length: 5 }, () => null as Side['grid'][0][0]),
  )
  DEMO_CARD_IDS.org.forEach((id, i) => {
    grid[Math.floor(i / 3)]![i % 3] = { card: cardById(id), budget: 0 }
  })
  return { grid, budget: 6, approvals: 3 }
}

/**
 * Turn each seat's points on in order, then hold the finished board.
 *
 * One clock rather than a chain of promises, so there is nothing to unwind when
 * the carousel moves on and nothing that can be left half played.
 */
class ScoreReveal extends Behavior {
  readonly #seats: readonly { node: CardNode; points: number }[]
  readonly #total: TextNode
  readonly #sum: number
  #t = 0
  #settled = false

  constructor(
    seats: readonly { node: CardNode; points: number }[],
    total: TextNode,
    sum: number,
  ) {
    super()
    this.#seats = seats
    this.#total = total
    this.#sum = sum
  }

  override onUpdate(dt: number): void {
    if (this.#settled) return
    this.#t += dt
    let shown = 0
    this.#seats.forEach((seat, i) => {
      const at = SCORE_LEAD + i * SCORE_STAGGER
      if (this.#t < at) return
      seat.node.setScore(seat.points)
      shown += seat.points
    })
    const last = SCORE_LEAD + (this.#seats.length - 1) * SCORE_STAGGER
    const done = this.#t >= last + SCORE_HOLD
    this.#total.text = String(done ? this.#sum : shown)
    this.#settled = done
  }
}

const SCORE_LEAD = 0.4
const SCORE_STAGGER = 0.22
/** Pause after the last seat, where the approvals land on the total. */
const SCORE_HOLD = 0.5

/**
 * Fade rings on one after another and leave them on.
 *
 * These cards point at a part of a card and then rest. Replaying takes the
 * reader back to before they had read it.
 */
function revealInTurn(rings: readonly ShapeNode[]): void {
  rings.forEach((ring, i) => {
    void ring
      .tween(
        { alpha: 1 },
        {
          duration: 0.3,
          delay: 0.45 + i * 0.55,
          easing: easings.outCubic,
        },
      )
      .catch(ignoreAbort)
  })
}

/**
 * Tutorial card scenes, built on the shared demo stage.
 *
 * Every card is a real board playing itself rather than a scripted mock-up, so
 * nothing here can drift out of step with the rules.
 *
 * All of them use a five-by-five grid with four colors, far smaller than
 * anything the game deals. A card has a few seconds and a small panel, and on a
 * real board a viewer cannot follow which cells a move took. At this size one
 * flood is legible at a glance, which is the only thing a card has to teach.
 *
 * Builders read the stage's fixed viewport rather than the primary renderer's
 * pixel size, since the demo canvas is its own surface at its own resolution.
 */
import { Behavior, Node2D, type EngineHost, type Stage } from '@src/stargazer'
import type { DemoHandle } from '@src/displays/arcade/tutorial/types'
import {
  buildAutoBoard,
  type AutoBoard,
  type AutoBoardOptions,
} from './autoBoard'
import { MoveMeterNode } from './nodes/HudNodes'
import type { Bounds } from './types'

/** Small enough that a single flood reads at a glance. */
const DEMO_GRID = { cols: 5, rows: 5, colors: 4 }

/** Inset of the board inside the demo viewport, as a fraction of the short side. */
const PAD_FRAC = 0.1

/**
 * Opacity of the board on the card that is about the counter.
 *
 * Low enough that a large light numeral reads cleanly over saturated cells,
 * while the flood is still visibly running underneath.
 */
const DIMMED = 0.32

/** A square centred in the demo viewport. */
function demoRect(stage: Stage): Bounds {
  // The demo stage always has a 2D camera, but the type allows none, and a
  // fallback square is a better failure than a thrown builder.
  const v = stage.currentCamera2D?.viewport ?? {
    x: 0,
    y: 0,
    width: 1000,
    height: 750,
  }
  const pad = Math.min(v.width, v.height) * PAD_FRAC
  const side = Math.min(v.width, v.height) - pad * 2
  return {
    x: v.x + (v.width - side) / 2,
    y: v.y + (v.height - side) / 2,
    width: side,
    height: side,
  }
}

/** Shared scaffolding: one self-playing board on the demo stage. */
function card(
  stage: Stage,
  host: EngineHost,
  opts: Omit<AutoBoardOptions, 'host' | 'parent' | 'rect' | 'grid'>,
  decorate?: (root: Node2D, board: AutoBoard, rect: Bounds) => void,
): DemoHandle {
  const root = new Node2D('flood-demo')
  root.renderLayer = 'dynamic'
  stage.tree.root.add(root)

  const rect = demoRect(stage)
  const board = buildAutoBoard({
    ...opts,
    grid: DEMO_GRID,
    host,
    parent: root,
    rect,
  })
  decorate?.(root, board, rect)

  return {
    destroy() {
      board.destroy()
      if (!root.isDestroyed) root.destroy()
    },
  }
}

/** Card one: what a move does. */
export function buildFloodDemo(stage: Stage, host: EngineHost): DemoHandle {
  return card(stage, host, { seed: 0x11, beat: 0.5, hold: 1.5 })
}

/** Card two: the shapes, for anyone who cannot separate the colors. */
export function buildGlyphDemo(stage: Stage, host: EngineHost): DemoHandle {
  return card(stage, host, { seed: 0x22, glyphs: true, beat: 0.5, hold: 1.5 })
}

/**
 * Card three: the move limit.
 *
 * The board runs dimmed behind a large counter, so the card reads as being
 * about the number rather than the flood. It is still the same board really
 * playing itself, so the count on screen is a count of real moves, and the
 * counter turns to its warning color on its own as the allowance runs down.
 */
export function buildLimitDemo(stage: Stage, host: EngineHost): DemoHandle {
  return card(
    stage,
    host,
    { seed: 0x33, beat: 0.5, hold: 1.6, alpha: DIMMED },
    (root, board, rect) => {
      const meter = new MoveMeterNode()
      meter.setSize(Math.min(rect.width, rect.height) * 0.3)
      meter.transform.x = rect.x + rect.width / 2
      meter.transform.y = rect.y + rect.height / 2
      root.add(meter)
      root.addBehavior(new MeterSync(meter, board))
    },
  )
}

/** Keeps the card's counter reading the board it sits over. */
class MeterSync extends Behavior {
  readonly #meter: MoveMeterNode
  readonly #board: AutoBoard

  constructor(meter: MoveMeterNode, board: AutoBoard) {
    super()
    this.#meter = meter
    this.#board = board
  }

  override onUpdate(): void {
    this.#meter.set(this.#board.moves, this.#board.limit)
  }
}

// The staff wall behind the menu.
//
// A grid of faces where most cells are empty and one person at a time comes or
// goes, so the office reads as busy without ever settling into rows. Only the
// menu shows it. Once a match starts the board is the picture.
//
// The faces are drawn bare, with no disc under them and no crop: on the card a
// portrait is a headshot on a badge, and here it is just the person.

import { Behavior, Node2D, type Gfx2D, type Rect } from '@src/stargazer'
import { seededRandom, type Random } from '../../../common/rng'
import { portraitRuns } from '../../art/portraits'
import { DECK } from '../rules/deck'
import type { Card } from '../rules/deck'
import { MENU_WALL } from '../tuning'

/** One cell of the grid, holding a face at some point between gone and here. */
export interface Cell {
  /** Left edge of the cell's sixteen-wide portrait grid. */
  x: number
  /** Top edge of the same. */
  y: number
  card: Card
  /** How visible the face is, 0 to 1. */
  alpha: number
  /** Where `alpha` is heading, 0 for leaving and 1 for arriving. */
  target: 0 | 1
}

/**
 * One person leaves, another arrives just behind them, then the wall rests.
 *
 * A single clock rather than a clock per cell. Cells on their own timers give a
 * steady churn with something always moving, which pulls the eye off the menu.
 * One swap at a time is slow enough to be scenery.
 */
class WallCycle extends Behavior {
  readonly #cells: Cell[]
  readonly #rng: Random
  #next: number = MENU_WALL.rest
  /** Seconds until the arrival that follows a departure, or null between swaps. */
  #arrival: number | null = null

  constructor(cells: Cell[], rng: Random) {
    super()
    this.#cells = cells
    this.#rng = rng
  }

  override onUpdate(dt: number): void {
    const step = dt / MENU_WALL.fade
    for (const cell of this.#cells) {
      if (cell.target > cell.alpha) cell.alpha = Math.min(1, cell.alpha + step)
      else if (cell.target < cell.alpha) {
        cell.alpha = Math.max(0, cell.alpha - step)
      }
    }
    if (this.#cells.length === 0) return

    if (this.#arrival !== null) {
      this.#arrival -= dt
      if (this.#arrival <= 0) {
        this.#arrival = null
        this.#arrive()
      }
    }
    this.#next -= dt
    if (this.#next > 0) return
    this.#next = MENU_WALL.fade * 2 + MENU_WALL.stagger + MENU_WALL.rest
    this.#leave()
    this.#arrival = MENU_WALL.stagger
  }

  /** Send one of the faces that is up on its way. */
  #leave(): void {
    const here = this.#cells.filter((c) => c.target === 1)
    const cell = here[Math.floor(this.#rng() * here.length)]
    if (cell) cell.target = 0
  }

  /**
   * Bring somebody new into an empty cell.
   *
   * Only cells that have finished fading count as empty, so an arrival never
   * lands on the person still walking out.
   */
  #arrive(): void {
    const free = this.#cells.filter((c) => c.target === 0 && c.alpha === 0)
    const cell = free[Math.floor(this.#rng() * free.length)]
    if (!cell) return
    cell.card = DECK[Math.floor(this.#rng() * DECK.length)]!
    cell.target = 1
  }
}

export class MenuBackdropNode extends Node2D {
  readonly #cells: Cell[] = []
  #cell = 0
  readonly #rng = seededRandom(0x0ff1ce)

  constructor(id: string) {
    super(id)
    this.renderLayer = 'dynamic'
    this.addBehavior(new WallCycle(this.#cells, this.#rng))
  }

  /** The grid as it stands, for the tests. */
  get cells(): readonly Cell[] {
    return this.#cells
  }

  /**
   * Lay the grid over the right of `rect`.
   *
   * The menu rail owns the left, so the wall starts where the rail ends. Row
   * and column counts come from a target cell height, so it keeps the same
   * density on a phone and on the cabinet, and every face sits on the lattice
   * with room around it rather than touching its neighbours.
   *
   * A share of the cells start already up, or the menu would open on an empty
   * wall and take a couple of minutes to fill.
   */
  setRect(rect: Rect): void {
    this.#cells.length = 0
    const left = rect.x + rect.width * MENU_WALL.railShare
    const width = rect.width - rect.width * MENU_WALL.railShare
    if (width <= 0 || rect.height <= 0) return

    const rows = Math.max(2, Math.round(1 / MENU_WALL.cell))
    const stepY = rect.height / rows
    const cols = Math.max(1, Math.floor(width / stepY))
    const stepX = width / cols
    const face = Math.min(stepX, stepY) * MENU_WALL.faceRatio
    this.#cell = face / 16

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const up = this.#rng() < MENU_WALL.fill
        this.#cells.push({
          x: left + (c + 0.5) * stepX - face / 2,
          y: rect.y + (r + 0.5) * stepY - face / 2,
          card: DECK[Math.floor(this.#rng() * DECK.length)]!,
          alpha: up ? 1 : 0,
          target: up ? 1 : 0,
        })
      }
    }
  }

  override draw(gfx: Gfx2D): void {
    if (this.#cell <= 0) return
    // Snapped so all sixteen columns come out the same width. These faces never
    // move, so there is no crawl to trade against.
    const cell = gfx.snapSize(this.#cell)
    for (const c of this.#cells) {
      if (c.alpha <= 0.001) continue
      gfx.save()
      if (c.alpha < 1) gfx.setAlpha(c.alpha)
      for (const run of portraitRuns(c.card)) {
        gfx.fillRect(
          c.x + run.x * cell,
          c.y + run.row * cell,
          run.len * cell,
          cell,
          run.color,
        )
      }
      gfx.restore()
    }
  }
}

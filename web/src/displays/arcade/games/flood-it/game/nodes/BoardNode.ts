/**
 * The board: the cells, the region outlines, and the flood animation.
 *
 * The rules resolve a move instantly. This node's job is to make that move
 * legible, so it keeps its own animation state in parallel typed arrays and
 * never touches the logical {@link Board}. `onUpdate` advances the arrays and
 * `paint` reads them, which is why a move allocates nothing and the rules stay
 * testable on their own.
 *
 * The picture is recorded again only while something is moving: a wave, the
 * glyph overlay, the loss dim or the win sweep. A settled board costs nothing.
 *
 * The wave is the whole point. Each touched cell starts late in proportion to
 * its breadth-first distance from the mover's corner, so a move reads as paint
 * spreading out of the corner rather than a grid changing color at once. The
 * two kinds of touched cell animate differently on purpose: a cell the mover
 * already held changes color, and a cell newly taken keeps its color and pops
 * in. That distinction is what makes it obvious which cells the move actually
 * won.
 */
import {
  definePaintProps,
  easings,
  Node2D,
  type Canvas,
  type Rect,
} from '@src/stargazer'
import {
  cellCenter,
  cellOrigin,
  colorAtWorld,
  wellRect,
  type FieldGeom,
} from '../layout'
import {
  ANIM,
  CELL_COLORS,
  CELL_GLYPHS,
  COLORS,
  floodStagger,
  GEOM,
  GLYPH_INKS,
} from '../tuning'
import { UNOWNED, type Color, type PlayerId } from '../types'
import type { Board, MoveResult } from '../board'
import { drawGlyph } from './glyphs'

/** Why a cell is animating. */
const KIND_SETTLED = 0
/** Held before the move, changing color. */
const KIND_REPAINT = 1
/** Taken by the move, keeping its color and popping in. */
const KIND_CAPTURE = 2
/** Arriving with a fresh deal. */
const KIND_DEAL = 3

/** How a player's region outline is drawn, so two regions never look alike. */
export interface RegionStyle {
  color: string
  /** Dashed for the second player, so the two read apart without color. */
  dashed: boolean
}

/**
 * Overrides for a board that is decoration rather than a game.
 *
 * The menu preview wants the same flood on the same node, but quiet: no line
 * tracking the region, no recess framing it, and a palette that reads as
 * texture instead of six competing hues.
 */
export interface BoardLook {
  /** Cell colors, replacing the game palette. Must cover the board's count. */
  palette?: readonly string[]
  /** Trace the owned region. Default true. */
  outline?: boolean
  /** Recess behind the cells. Null draws none. */
  well?: string | null
  /**
   * Crop every draw to this rect, in the same space as the board's own
   * geometry.
   *
   * For a board sized past the edge of its view on purpose, so it reads as
   * texture with no boundary anywhere on screen. The arcade's regions sit in
   * one world with only a band of sky between them, so an unbounded overhang is
   * visible from the neighbouring region even though it is off screen here.
   */
  clip?: Rect
}

export class BoardNode extends Node2D {
  declare geom: FieldGeom
  #board: Board
  readonly #players: readonly PlayerId[]
  readonly #styles: Record<number, RegionStyle>

  /** Color a cell fades from. */
  #from: Uint8Array
  /** Color a cell fades to, which mirrors the board for cells it knows about. */
  #to: Uint8Array
  /** Progress: below 0 is a pending delay, 0 to 1 animates, 1 is settled. */
  #waveT: Float32Array
  #kind: Uint8Array

  /** Glyph overlay strength, tweened so a toggle mid-board is not a pop. */
  declare glyphT: number
  #glyphsOn = false
  /** Unowned cells fade toward the dim ink on a loss. */
  declare dimT: number
  #dimOn = false
  /** Celebration sweep, run once on a win. */
  declare winT: number
  declare palette: readonly string[]
  declare outline: boolean
  declare well: string | null
  /** The rect every draw is cropped to, or null for none. */
  declare crop: Rect | null

  constructor(
    geom: FieldGeom,
    board: Board,
    players: readonly PlayerId[],
    styles: Record<number, RegionStyle>,
    onPickColor?: (color: Color) => void,
  ) {
    super('flood-board')
    definePaintProps(this, {
      geom,
      glyphT: 0,
      dimT: 0,
      winT: 1,
      palette: CELL_COLORS,
      outline: true,
      well: COLORS.well,
      crop: null,
    })
    this.#board = board
    this.#players = players
    this.#styles = styles
    const total = board.color.length
    this.#from = new Uint8Array(total)
    this.#to = new Uint8Array(total)
    this.#waveT = new Float32Array(total)
    this.#kind = new Uint8Array(total)
    this.dealIn()

    // Tapping a tile is the same as pressing that color's button. On a board
    // this size the tile is the thing a hand reaches for, and the buttons stay
    // as the way to pick a color that is not on screen next to your region.
    if (onPickColor) {
      this.hitEnabled = true
      this.#syncBounds()
      this.bindPointer({
        down: (e) => {
          const color = colorAtWorld(
            this.geom,
            this.#board.color,
            e.pointer.world.x,
            e.pointer.world.y,
          )
          if (color !== null) onPickColor(color)
        },
      })
    }
  }

  /** Re-fit to a new board rect, on resize. */
  setGeom(geom: FieldGeom): void {
    this.geom = geom
    if (this.hitEnabled) this.#syncBounds()
  }

  /** Point at a fresh board and sweep it in. */
  setBoard(board: Board): void {
    this.#board = board
    this.markNeedsPaint()
    const total = board.color.length
    if (this.#waveT.length !== total) {
      this.#from = new Uint8Array(total)
      this.#to = new Uint8Array(total)
      this.#waveT = new Float32Array(total)
      this.#kind = new Uint8Array(total)
    }
    this.dealIn()
  }

  /** Sweep the cells in diagonally, as a fresh deal arrives. */
  dealIn(): void {
    const { cols, rows } = this.geom
    const span = Math.max(1, cols + rows - 2)
    const stagger = (ANIM.dealDurationCap - ANIM.dealFlip) / span
    this.#from.set(this.#board.color)
    this.#to.set(this.#board.color)
    this.dimT = 0
    this.#dimOn = false
    this.winT = 1
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col
        this.#waveT[i] = -(col + row) * stagger
        this.#kind[i] = KIND_DEAL
      }
    }
    this.markNeedsPaint()
  }

  /**
   * Start the wave for a move that has already been applied to the board.
   *
   * Must be called while `result` is still the mover's live buffer, which is
   * why the session hands it over synchronously from its `moved` event.
   */
  applyWave(result: MoveResult): void {
    const stagger = floodStagger(result.maxDepth)
    const { cells, depth, captured, count } = result
    for (let n = 0; n < count; n++) {
      const i = cells[n]!
      // A cell still in flight snaps to the color it was heading for, so the
      // new wave has somewhere to start from. On a fast double tap that is a
      // barely visible jump, and far better than dropping the tap.
      this.#from[i] = this.#to[i]!
      this.#to[i] = this.#board.color[i]!
      this.#waveT[i] = -depth[n]! * stagger
      this.#kind[i] = captured[n] === 1 ? KIND_CAPTURE : KIND_REPAINT
    }
    this.markNeedsPaint()
  }

  /** Show or hide the shape overlay. */
  setGlyphs(on: boolean): void {
    this.#glyphsOn = on
  }

  /** Dim what nobody claimed, for a board that ran out of moves. */
  setDimmed(on: boolean): void {
    this.#dimOn = on
  }

  /** Run the celebration sweep once. */
  celebrate(): void {
    this.winT = 0
  }

  /** Fade the whole board uniformly, to sit it behind an overlay. */
  setOpacity(opacity: number): void {
    this.transform.alpha = opacity
  }

  /** Restyle the board, for a decorative one. See {@link BoardLook}. */
  setLook(look: BoardLook): void {
    if (look.palette) this.palette = look.palette
    if (look.outline !== undefined) this.outline = look.outline
    if (look.well !== undefined) this.well = look.well
    if (look.clip !== undefined) this.crop = look.clip ?? null
  }

  override onUpdate(dt: number): void {
    const waveT = this.#waveT
    const kind = this.#kind
    const dealRate = dt / ANIM.dealFlip
    const floodRate = dt / ANIM.floodFlip
    let moving = false
    for (let i = 0; i < waveT.length; i++) {
      const t = waveT[i]!
      if (t >= 1) continue
      moving = true
      const next = t + (kind[i] === KIND_DEAL ? dealRate : floodRate)
      if (next >= 1) {
        waveT[i] = 1
        kind[i] = KIND_SETTLED
      } else {
        waveT[i] = next
      }
    }

    const glyphTarget = this.#glyphsOn ? 1 : 0
    const glyphStep = dt / ANIM.glyphFade
    this.glyphT = approach(this.glyphT, glyphTarget, glyphStep)

    const dimTarget = this.#dimOn ? 1 : 0
    this.dimT = approach(this.dimT, dimTarget, dt / ANIM.lossDim)

    if (this.winT < 1) {
      this.winT = Math.min(1, this.winT + dt / ANIM.winPulse)
    }

    // The wave arrays are not declared inputs, so a moving cell repaints by hand.
    if (moving) this.markNeedsPaint()
  }

  override paint(gfx: Canvas): void {
    if (this.crop === null) {
      this.#paintBoard(gfx)
      return
    }
    const c = this.crop
    gfx.save()
    // Square corners: a radius here would round the crop itself, and the crop
    // is meant to fall on the view's own edge where it cannot be seen.
    gfx.setClip({
      kind: 'roundRect',
      x: c.x,
      y: c.y,
      w: c.width,
      h: c.height,
      radius: 0,
    })
    this.#paintBoard(gfx)
    gfx.restore()
  }

  #paintBoard(gfx: Canvas): void {
    const g = this.geom
    const { cols, rows, cell, pitch } = g
    const well = wellRect(g)
    const radius = cell * GEOM.cellRadiusFrac
    const palette = this.palette
    const glyphT = this.glyphT
    const dimT = this.dimT
    const winT = this.winT

    if (this.well !== null) {
      gfx.fillRoundRect(
        well.x,
        well.y,
        well.width,
        well.height,
        pitch * GEOM.wellRadiusFrac,
        this.well,
      )
    }

    const owner = this.#board.owner
    const glyphSize = cell * GEOM.glyphFrac
    const winSpan = cols + rows
    const drawGlyphs = glyphT > 0.01

    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col
        const t = this.#waveT[i]!
        const kind = this.#kind[i]!

        // A pending cell has not started, so it still shows what it showed
        // before the move. A dealt cell has nothing to show yet at all.
        const pending = t < 0
        if (pending && kind === KIND_DEAL) continue

        const fade = pending ? 0 : t >= 1 ? 1 : easings.inOutQuad(t)
        const grow =
          kind === KIND_CAPTURE || kind === KIND_DEAL
            ? pending
              ? ANIM.absorbScaleFrom
              : ANIM.absorbScaleFrom +
                (1 - ANIM.absorbScaleFrom) * easings.outBack(t)
            : 1

        const size = cell * grow
        const inset = (cell - size) / 2
        const o = cellOrigin(g, col, row)
        const x = o.x + inset
        const y = o.y + inset
        const r = radius * grow

        const fromColor = palette[this.#from[i]!]!
        const toColor = palette[this.#to[i]!]!

        // Base then overlay, rather than mixing the two colors into a new
        // string: a mix would allocate once per cell per frame, and alpha rides
        // the instance data for free.
        gfx.fillRoundRect(x, y, size, size, r, fromColor)
        if (fade > 0 && toColor !== fromColor) {
          gfx.setAlpha(fade)
          gfx.fillRoundRect(x, y, size, size, r, toColor)
          gfx.setAlpha(1)
        }

        if (drawGlyphs) {
          // Opaque, and one glyph rather than two cross-fading. Several glyphs
          // are drawn in more than one pass, so any translucency shows the seam
          // where those passes overlap. The glyph therefore swaps at the
          // half-way point of the cell's own color change, and the toggle
          // scales it in instead of fading it.
          const c = cellCenter(g, col, row)
          const shown = fade < 0.5 ? this.#from[i]! : this.#to[i]!
          const gs = glyphSize * grow * easings.outBack(glyphT)
          if (gs > 0) {
            drawGlyph(
              gfx,
              CELL_GLYPHS[shown]!,
              c.x,
              c.y,
              gs,
              GLYPH_INKS[shown]!,
            )
          }
        }

        if (dimT > 0 && owner[i] === UNOWNED) {
          gfx.setAlpha(dimT)
          gfx.fillRoundRect(x, y, size, size, r, COLORS.dim)
          gfx.setAlpha(1)
        }

        if (winT < 1) {
          // A bright crest riding out from the corner, one pass, then done.
          const phase = (col + row) / winSpan
          const pulse = crest(winT * 1.6 - phase)
          if (pulse > 0) {
            gfx.setAlpha(pulse * 0.55)
            gfx.fillRoundRect(x, y, size, size, r, COLORS.paper)
            gfx.setAlpha(1)
          }
        }
      }
    }

    if (this.outline) this.#paintRegionOutline(gfx)
  }

  /**
   * Outline each region by stroking only the cell edges that face something the
   * player does not hold, with the convex corners rounded off.
   *
   * The stroke runs along the pitch grid, midway between neighbouring tiles, so
   * consecutive edges meet end to end and read as one line around the whole
   * owned area rather than a border on each tile. Where two boundary edges meet
   * at an outside corner both are pulled back and a quadratic joins them,
   * giving the line a corner radius that matches the tiles it wraps. Inside
   * corners need nothing: the two edges already meet in a straight line.
   *
   * Opaque, and each edge is drawn once, so nothing double-blends.
   */
  #paintRegionOutline(gfx: Canvas): void {
    const g = this.geom
    const { cols, rows, cell, pitch } = g
    const owner = this.#board.owner
    // Concentric with the tile: the tile's own radius plus the distance from its
    // edge out to the pitch line the stroke runs along.
    const gap = (pitch - cell) / 2
    const r = Math.min(cell * GEOM.cellRadiusFrac + gap, pitch / 2)

    for (const player of this.#players) {
      const style = this.#styles[player]
      if (!style) continue
      const stroke = {
        color: style.color,
        width: pitch * GEOM.outlineFrac,
        cap: 'butt' as const,
        join: 'round' as const,
      }
      const owns = (col: number, row: number): boolean =>
        col >= 0 &&
        col < cols &&
        row >= 0 &&
        row < rows &&
        owner[row * cols + col] === player

      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < cols; col++) {
          const i = row * cols + col
          if (owner[i] !== player) continue
          // A cell whose wave has not started is not on screen yet, so its
          // outline would arrive before the tile it belongs to.
          if (this.#waveT[i]! < 0) continue

          const x0 = g.x + col * pitch
          const y0 = g.y + row * pitch
          const x1 = x0 + pitch
          const y1 = y0 + pitch
          const up = !owns(col, row - 1)
          const down = !owns(col, row + 1)
          const left = !owns(col - 1, row)
          const right = !owns(col + 1, row)

          // Each edge is pulled back only at an end where the perpendicular
          // edge is also on the boundary, which is exactly where a corner arc
          // will take over.
          if (up) {
            gfx.strokeLine(
              x0 + (left ? r : 0),
              y0,
              x1 - (right ? r : 0),
              y0,
              stroke,
            )
          }
          if (down) {
            gfx.strokeLine(
              x0 + (left ? r : 0),
              y1,
              x1 - (right ? r : 0),
              y1,
              stroke,
            )
          }
          if (left) {
            gfx.strokeLine(
              x0,
              y0 + (up ? r : 0),
              x0,
              y1 - (down ? r : 0),
              stroke,
            )
          }
          if (right) {
            gfx.strokeLine(
              x1,
              y0 + (up ? r : 0),
              x1,
              y1 - (down ? r : 0),
              stroke,
            )
          }

          if (up && left) {
            gfx.strokeQuadratic(x0, y0 + r, x0, y0, x0 + r, y0, stroke)
          }
          if (up && right) {
            gfx.strokeQuadratic(x1 - r, y0, x1, y0, x1, y0 + r, stroke)
          }
          if (down && left) {
            gfx.strokeQuadratic(x0 + r, y1, x0, y1, x0, y1 - r, stroke)
          }
          if (down && right) {
            gfx.strokeQuadratic(x1, y1 - r, x1, y1, x1 - r, y1, stroke)
          }
        }
      }
    }
  }

  /** Taps land on the recess, which is the board's hit region. */
  #syncBounds(): void {
    const well = wellRect(this.geom)
    this.boundsOverride = {
      x: well.x,
      y: well.y,
      width: well.width,
      height: well.height,
    }
  }
}

/** Step `value` toward `target` by at most `step`. */
function approach(value: number, target: number, step: number): number {
  if (value < target) return Math.min(target, value + step)
  if (value > target) return Math.max(target, value - step)
  return value
}

/** A short 0-up-0 crest, for a one-pass sweep. Zero outside `0..1`. */
function crest(t: number): number {
  if (t <= 0 || t >= 1) return 0
  return Math.sin(t * Math.PI)
}

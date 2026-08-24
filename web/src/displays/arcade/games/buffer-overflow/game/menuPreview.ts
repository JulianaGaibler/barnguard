/**
 * The in-engine backdrop behind the menu, filling the right side of the region
 * the rail leaves free.
 *
 * A slow ambient fall of pieces down an unplayed buffer: the game's own
 * vocabulary at rest, rather than a still image of it. Pieces drift down,
 * settle for a moment and fade, so the field never fills and never needs
 * clearing.
 *
 * Nothing here reads the session. It is decoration, and building it out of the
 * same cell primitive the game uses is what keeps the two looking related.
 */
import { Node2D, clamp, easings, type Gfx2D, type Rect } from '@src/stargazer'
import type { MenuPreview } from '../../../menu/types'
import type { EngineHost } from '@src/stargazer'
import { seededRandom } from '../../common/rng'
import { PIECE_KINDS, pieceCells } from './pieces'
import { COLORS } from './tuning'
import type { PieceKind, Rotation } from './types'
import { drawCell } from './nodes/cells'

/** Pieces adrift at once. Enough to read as a field, few enough to stay calm. */
const COUNT = 14
/** Seconds one piece takes to cross the view. */
const FALL_SECONDS = 9

interface Drifter {
  kind: PieceKind
  rot: Rotation
  /** Column position, in cells, across the cover rect. */
  col: number
  /** Progress down the view, 0 to 1, wrapping. */
  t: number
  speed: number
  spin: number
}

class MenuPreviewNode extends Node2D {
  readonly #view: Rect
  /** The game region. Everything is clipped to it, see {@link draw}. */
  readonly #region: Rect
  readonly #cell: number
  readonly #drifters: Drifter[] = []
  #elapsed = 0

  constructor(view: Rect, region: Rect) {
    super('bo-menu-preview')
    this.renderLayer = 'dynamic'
    this.#view = view
    this.#region = region
    this.#cell = view.height / 22
    // Seeded, so the menu looks the same every time the booth opens it rather
    // than being subtly different on each visit.
    const random = seededRandom(0x0bffe201)
    const columns = Math.ceil(view.width / (this.#cell * 4))
    for (let i = 0; i < COUNT; i++) {
      this.#drifters.push({
        kind: PIECE_KINDS[Math.floor(random() * PIECE_KINDS.length)],
        rot: Math.floor(random() * 4) as Rotation,
        col: Math.floor(random() * columns) * 4 + 1,
        t: random(),
        speed: 0.6 + random() * 0.8,
        spin: random() < 0.3 ? 1 : 0,
      })
    }
    this.debugBounds = {
      x: view.x,
      y: view.y,
      width: view.width,
      height: view.height,
    }
  }

  override onUpdate(dt: number): void {
    this.#elapsed += dt
    for (const d of this.#drifters) {
      d.t += (dt / FALL_SECONDS) * d.speed
      if (d.t >= 1) {
        d.t -= 1
        // Re-rolled on the way round, so the field never settles into a loop
        // the eye can pick out.
        d.rot = ((d.rot + 1) % 4) as Rotation
      }
    }
  }

  override draw(gfx: Gfx2D): void {
    const v = this.#view
    const cell = this.#cell
    // Clipped to the region, not the cover rect. The cover rect deliberately
    // overflows so the field has no visible edge, and without this the overflow
    // hangs into the launcher below and is visible from there.
    const r = this.#region
    gfx.save()
    gfx.setClip({
      kind: 'roundRect',
      x: r.x,
      y: r.y,
      w: r.width,
      h: r.height,
      radius: 0,
    })
    // A wash of the opening accent over the backdrop, so the preview reads as
    // the same object the board is cut from.
    gfx.fillRect(v.x, v.y, v.width, v.height, COLORS.backdropTop)

    for (const d of this.#drifters) {
      const y = v.y - cell * 4 + d.t * (v.height + cell * 8)
      const x = v.x + d.col * cell
      // Fade in at the top and out at the bottom, so nothing pops at an edge.
      const edge = Math.min(d.t, 1 - d.t) / 0.15
      gfx.setAlpha(clamp(edge, 0, 1) * 0.55)
      const rot = d.spin
        ? (((d.rot + Math.floor(this.#elapsed * 0.3)) % 4) as Rotation)
        : d.rot
      for (const c of pieceCells(d.kind, rot)) {
        drawCell(gfx, d.kind, x + c.x * cell, y + c.y * cell, cell)
      }
      gfx.setAlpha(1)
    }

    gfx.restore()
  }
}

/**
 * Build the preview over `view`, culled to `region`.
 *
 * `view` is the cover rect at the region aspect, so the field fills the visible
 * area at any window shape rather than leaving borders.
 */
export function buildBufferOverflowMenuPreview(
  host: EngineHost,
  view: Rect,
  region: Rect,
): MenuPreview {
  const root = new Node2D('bo-menu-preview-root')
  const node = new MenuPreviewNode(view, region)
  root.add(node)
  host.engine.tree.root.add(root)
  // Held so the fade-in below has something to animate against, and so a
  // resize rebuild does not flash.
  root.transform.alpha = 0
  root.play(
    { alpha: 1 },
    { duration: 0.4, easing: easings.outCubic, key: 'preview-in' },
  )
  return {
    destroy: () => {
      if (!root.isDestroyed) root.destroy()
    },
  }
}

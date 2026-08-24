/**
 * A titled pane, and the faint rules dividing it into sections.
 *
 * Used twice per seat. The sections that live inside it are separate nodes
 * drawing into rects the layout handed them, so this owns nothing but the frame
 * and the dividers, and knows nothing about what it contains.
 *
 * Dividers are derived from the section rects rather than passed in, so a
 * section that the ladder dropped takes its divider with it and there is no
 * second list to keep in step.
 */
import { Node2D, type CameraView2D, type Gfx2D } from '@src/stargazer'
import { font } from '../../fonts'
import { textFloor } from '../layout'
import { accentForLevel, COLORS, FRAME } from '../tuning'
import type { Bounds } from '../types'
import { drawDivider, drawFrame, ruleWidth } from './tui'

const ZERO: Bounds = { x: 0, y: 0, width: 0, height: 0 }

export class PaneNode extends Node2D {
  readonly #title: string
  #rect: Bounds = ZERO
  #cell = 1
  #sections: readonly Bounds[] = []
  #accent = accentForLevel(1)

  constructor(title: string) {
    super(`bo-pane-${title}`)
    this.renderLayer = 'dynamic'
    this.#title = title
  }

  setRect(rect: Bounds, cell: number): void {
    this.#rect = rect
    this.#cell = cell
    this.debugBounds = { ...rect }
  }

  /** The sections inside, in order. Empty ones are ignored. */
  setSections(sections: readonly Bounds[]): void {
    this.#sections = sections.filter((s) => s.height > 0)
  }

  setLevel(level: number): void {
    this.#accent = accentForLevel(level)
  }

  override draw(gfx: Gfx2D, camera: CameraView2D): void {
    const r = this.#rect
    if (r.width <= 0 || r.height <= 0) return
    const scale = camera.strokeSpaceScale()
    const rule = ruleWidth(gfx, FRAME.rulePx, scale)
    const size = Math.max(textFloor(scale), this.#cell * 0.4)

    drawFrame(gfx, r, {
      color: COLORS.rule,
      width: rule,
      fill: COLORS.pane,
      title: { text: this.#title, font: font(400, size), color: this.#accent },
    })

    // Halfway down each gap between two sections, so a rule always reads as
    // belonging to both rather than crowding one.
    for (let i = 1; i < this.#sections.length; i++) {
      const above = this.#sections[i - 1]
      const below = this.#sections[i]
      const gap = below.y - (above.y + above.height)
      if (gap <= 0) continue
      const y = above.y + above.height + gap / 2
      drawDivider(gfx, r, y, COLORS.ruleFaint, rule)
    }
  }
}

/**
 * A row of heart-slot icons — the engine port of `Hearts.svelte`/`Heart.svelte`.
 * Every heart is a stroked outline, never filled (the original SVG is
 * `fill="none"` too): a lit heart uses the player's color at a thicker
 * stroke, an empty slot uses a muted ink tint at a thinner one.
 */
import { Node2D, parseSvgPaths, type Camera, type Gfx2D } from '@src/stargazer'
import heartSvgRaw from '../../assets/heart.svg?raw'

const HEART = Array.from(
  parseSvgPaths(heartSvgRaw, { tessellate: true }).paths.values(),
)[0]
const VIEWBOX = 24 // heart.svg's viewBox is 0 0 24 24
const GAP_PX = 5.6 // 0.35rem
const EMPTY_COLOR = 'rgba(39, 39, 39, 0.32)'

export type HeartsAlign = 'left' | 'right' | 'center'

export interface HeartsOptions {
  max: number
  color: string
  align: HeartsAlign
  sizePx: number
}

export class HeartsNode extends Node2D {
  readonly #max: number
  readonly #color: string
  readonly #align: HeartsAlign
  readonly #sizePx: number
  #lives = 0

  constructor(opts: HeartsOptions) {
    super('jb-hearts')
    this.renderLayer = 'dynamic'
    this.#max = opts.max
    this.#color = opts.color
    this.#align = opts.align
    this.#sizePx = opts.sizePx
  }

  setLives(lives: number): void {
    this.#lives = lives
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    if (!HEART) return
    const s = camera.strokeSpaceScale()
    const size = this.#sizePx * s
    const gap = GAP_PX * s
    const scale = size / VIEWBOX
    const step = size + gap
    const rowWidth = this.#max * size + (this.#max - 1) * gap
    const startX =
      this.#align === 'center' ? -rowWidth / 2 : this.#align === 'right' ? -rowWidth : 0

    for (let i = 0; i < this.#max; i++) {
      // Right-aligned rows fill from the outer edge inward, so a losing
      // player's hearts drain toward the center.
      const idx = this.#align === 'right' ? this.#max - 1 - i : i
      const filled = idx < this.#lives
      const width = filled ? 2.4 : 2
      gfx.save()
      gfx.translate(startX + i * step, -size / 2)
      gfx.scale(scale, scale)
      gfx.strokePath2D(HEART.path, {
        color: filled ? this.#color : EMPTY_COLOR,
        width: (width * s) / scale,
      })
      gfx.restore()
    }
  }
}

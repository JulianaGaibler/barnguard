/**
 * A score readout: a label over a number, on its own small slab so it belongs
 * to the same toybox as the board. The number counts up to a new value rather
 * than snapping, so a big merge is legible as a big gain.
 */
import { easings, mixColor, Node2D, type Gfx2D } from '@src/stargazer'
import { font, headingFont } from '../../fonts'
import { ANIM, BEVEL, COLORS } from '../tuning'
import { drawSlab } from './bevel'

export class ScoreBadgeNode extends Node2D {
  #label: string
  #accent: string
  #width: number
  #height: number
  #target = 0
  #shown = 0
  /** Where the current count-up started, so the ease reads from the right place. */
  #from = 0
  #t = 1
  /** Set for text that is not a number, such as the largest tile reached. */
  #literal: string | null = null

  constructor(label: string, accent: string, width: number, height: number) {
    super('t48-score')
    this.renderLayer = 'dynamic'
    this.#label = label
    this.#accent = accent
    this.#width = width
    this.#height = height
    this.#refit()
  }

  setSize(width: number, height: number): void {
    this.#width = width
    this.#height = height
    this.#refit()
  }

  #refit(): void {
    this.debugBounds = {
      x: 0,
      y: 0,
      width: this.#width,
      height: this.#height * 1.3,
    }
  }

  /** Count up to `value`. */
  setValue(value: number): void {
    if (value === this.#target) return
    this.#from = this.#shown
    this.#target = value
    this.#t = 0
  }

  /** Show `text` instead of a number, for the largest-tile readout. */
  setLiteral(text: string): void {
    this.#literal = text
  }

  /** Jump straight to `value`, for a fresh board. */
  resetTo(value: number): void {
    this.#target = value
    this.#shown = value
    this.#from = value
    this.#t = 1
  }

  override onUpdate(dt: number): void {
    if (this.#t >= 1) return
    this.#t = Math.min(1, this.#t + dt / ANIM.scoreCount)
    const eased = easings.outCubic(this.#t)
    this.#shown = Math.round(this.#from + (this.#target - this.#from) * eased)
  }

  override draw(gfx: Gfx2D): void {
    const w = this.#width
    const h = this.#height
    const face = mixColor(COLORS.plate, this.#accent, 0.22)

    drawSlab(gfx, {
      x: 0,
      y: 0,
      w,
      h,
      radius: h * 0.28,
      depth: h * 0.09,
      face,
      skirt: mixColor(face, '#000000', BEVEL.skirtMix),
      highlight: mixColor(face, COLORS.white, BEVEL.highlightMix * 0.7),
      band: h * 0.05,
    })

    gfx.fillText(this.#label.toUpperCase(), w / 2, h * 0.28, {
      font: font(700, h * 0.19),
      align: 'center',
      baseline: 'middle',
      color: mixColor(COLORS.inkLight, face, 0.35),
    })
    gfx.fillText(this.#literal ?? String(this.#shown), w / 2, h * 0.63, {
      font: headingFont(700, h * 0.38),
      align: 'center',
      baseline: 'middle',
      color: COLORS.inkLight,
    })
  }
}

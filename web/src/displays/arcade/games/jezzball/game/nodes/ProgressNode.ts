/**
 * Bottom progress readout — engine port of `Progress.svelte`. Solo: a track
 * filled to the captured percentage with the big number over it, plus a
 * small accent dot and "of N%". Versus: both players' percentages flank a
 * shared vertical "of N%" pill, each growing its own vertical meter.
 */
import { SceneNode, type Gfx2D } from '@src/stargazer'
import { COLORS, PROGRESS_ACCENT } from '../tuning'

const FONT_FAMILY = 'system-ui, sans-serif'
const TRACK_FILL = 'rgba(39, 39, 39, 0.14)'

export type ProgressMode = 'solo' | 'versus'

export interface ProgressOptions {
  mode: ProgressMode
  target: number
  /** Solo track width; ignored in versus mode. */
  width: number
}

export class ProgressNode extends SceneNode {
  readonly #mode: ProgressMode
  readonly #target: number
  #width: number
  #pct = 0
  #leftPct = 0
  #rightPct = 0

  constructor(opts: ProgressOptions) {
    super('jb-progress')
    this.renderLayer = 'dynamic'
    this.#mode = opts.mode
    this.#target = opts.target
    this.#width = opts.width
  }

  setWidth(width: number): void {
    this.#width = width
  }

  setSolo(pct: number): void {
    this.#pct = pct
  }

  setVersus(leftPct: number, rightPct: number): void {
    this.#leftPct = leftPct
    this.#rightPct = rightPct
  }

  override draw(gfx: Gfx2D): void {
    if (this.#mode === 'solo') this.#drawSolo(gfx)
    else this.#drawVersus(gfx)
  }

  #drawSolo(gfx: Gfx2D): void {
    const w = this.#width
    const trackH = 27.2
    const trackY = -trackH / 2
    const pct = Math.min(100, this.#pct)
    gfx.fillRect(-w / 2, trackY, w, trackH, COLORS.white)
    gfx.fillRect(-w / 2, trackY, w * (pct / 100), trackH, TRACK_FILL)
    gfx.strokeRoundRect(-w / 2, trackY, w, trackH, 0, { color: COLORS.ink, width: 2 })

    const numFont = 57.6
    const metaFont = 13.6
    const numText = String(Math.round(pct))
    // Rough number width so the number + meta block centers as one unit,
    // matching the original flex row's layout.
    const numW = numText.length * numFont * 0.62
    const gap = 9.6
    const metaW = 70
    const numCX = -(numW + gap + metaW) / 2 + numW / 2
    gfx.fillText(numText, numCX, 0, {
      font: `800 ${numFont}px ${FONT_FAMILY}`,
      align: 'center',
      baseline: 'middle',
      color: COLORS.ink,
    })
    const metaX = numCX + numW / 2 + gap
    const dot = 8
    gfx.fillRect(metaX, -14, dot, dot, PROGRESS_ACCENT)
    gfx.fillText(`of ${this.#target}%`, metaX, 4, {
      font: `700 ${metaFont}px ${FONT_FAMILY}`,
      align: 'left',
      baseline: 'middle',
      color: COLORS.ink,
    })
  }

  #drawVersus(gfx: Gfx2D): void {
    const numFont = 57.6
    const barW = 8
    const barH = 70
    const gap = 24
    const dividerW = 30
    const dividerH = 60
    const centerX = 0
    const leftBarX = centerX - dividerW / 2 - gap - barW
    const rightBarX = centerX + dividerW / 2 + gap

    const drawMeter = (x: number, fillFrac: number): void => {
      gfx.fillRect(x, -barH / 2, barW, barH, 'rgba(39, 39, 39, 0.14)')
      const fillH = barH * Math.min(1, fillFrac / 100)
      gfx.fillRect(x, barH / 2 - fillH, barW, fillH, PROGRESS_ACCENT)
    }
    drawMeter(leftBarX, this.#leftPct / this.#target * 100)
    drawMeter(rightBarX, this.#rightPct / this.#target * 100)

    gfx.fillText(String(Math.round(this.#leftPct)), leftBarX - 12, 0, {
      font: `800 ${numFont}px ${FONT_FAMILY}`,
      align: 'right',
      baseline: 'middle',
      color: COLORS.ink,
    })
    gfx.fillText(String(Math.round(this.#rightPct)), rightBarX + barW + 12, 0, {
      font: `800 ${numFont}px ${FONT_FAMILY}`,
      align: 'left',
      baseline: 'middle',
      color: COLORS.ink,
    })

    // The "of N%" divider, rotated to read top-to-bottom like the original's
    // `writing-mode: vertical-rl` pill.
    gfx.fillRoundRect(-dividerW / 2, -dividerH / 2, dividerW, dividerH, 4, PROGRESS_ACCENT)
    gfx.save()
    gfx.rotate(Math.PI / 2)
    gfx.fillText(`of ${this.#target}%`, 0, 0, {
      font: `800 19.2px ${FONT_FAMILY}`,
      align: 'center',
      baseline: 'middle',
      color: COLORS.white,
    })
    gfx.restore()
  }
}

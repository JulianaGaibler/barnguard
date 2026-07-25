/**
 * The LVL / PTS readout — engine port of `Badge.svelte`: a circle outline
 * overlapping a same-size square outline, a small corner label, a big value,
 * and a solid ink tab in the opposite corner (showing the same label). The
 * square (a circle reads the same at any angle) snaps a quarter turn as a
 * change accent whenever a new `spinKey` arrives, easing to the next quarter
 * over half a second.
 */
import { SceneNode, easings, measureText, type Gfx2D } from '@src/stargazer'
import { COLORS } from '../tuning'

export interface BadgeOptions {
  label: string
  color: string
  size: number
  labelCorner: 'tl' | 'tr'
  tabCorner: 'bl' | 'br'
}

const SPIN_DURATION_SEC = 0.5
const FONT_FAMILY = 'system-ui, sans-serif'

export class BadgeNode extends SceneNode {
  readonly #label: string
  readonly #color: string
  #size: number
  readonly #labelCorner: 'tl' | 'tr'
  readonly #tabCorner: 'bl' | 'br'
  #value = ''
  #turns = 0
  #spinFrom = 0
  #spinT = 1 // 1 = settled, no turn in flight
  #spinKey: string | number | undefined

  constructor(opts: BadgeOptions) {
    super('jb-badge')
    this.renderLayer = 'dynamic'
    this.#label = opts.label
    this.#color = opts.color
    this.#size = opts.size
    this.#labelCorner = opts.labelCorner
    this.#tabCorner = opts.tabCorner
  }

  setSize(size: number): void {
    this.#size = size
  }

  /** Set the displayed value; a new `spinKey` triggers the quarter-turn accent. */
  setValue(value: string, spinKey: string | number): void {
    this.#value = value
    if (this.#spinKey !== undefined && spinKey !== this.#spinKey) {
      this.#spinFrom = this.#turns
      this.#turns += 1
      this.#spinT = 0
    }
    this.#spinKey = spinKey
  }

  override onUpdate(dt: number): void {
    if (this.#spinT < 1) this.#spinT = Math.min(1, this.#spinT + dt / SPIN_DURATION_SEC)
  }

  override draw(gfx: Gfx2D): void {
    const size = this.#size
    const half = size / 2
    const eased = easings.outCubic(this.#spinT)
    const turns = this.#spinFrom + (this.#turns - this.#spinFrom) * eased
    const angle = (turns * 90 * Math.PI) / 180
    const motif = size * 0.92
    const border = { color: COLORS.ink, width: 2 }

    // The square carries the visible spin; a circle reads the same at any
    // angle, so it's drawn once, unrotated.
    gfx.save()
    gfx.translate(half, half)
    gfx.rotate(angle)
    gfx.strokeRoundRect(-motif / 2, -motif / 2, motif, motif, 0, border)
    gfx.restore()
    gfx.strokeCircle(half, half, motif / 2, border)

    const labelX = half + (this.#labelCorner === 'tr' ? size * 0.28 : -size * 0.28)
    gfx.fillText(this.#label, labelX, size * 0.2, {
      font: `800 ${size * 0.1}px ${FONT_FAMILY}`,
      align: this.#labelCorner === 'tr' ? 'right' : 'left',
      baseline: 'top',
      color: COLORS.ink,
    })

    // Big value, shrinking past 3 characters like the original.
    const len = this.#value.length
    const valueFrac = len > 3 ? 0.36 * (3 / len) : 0.36
    gfx.fillText(this.#value, half, half, {
      font: `800 ${size * valueFrac}px ${FONT_FAMILY}`,
      align: 'center',
      baseline: 'middle',
      color: this.#color,
    })

    // Solid ink tab in the opposite corner, sized to fit the label exactly.
    const tabFont = size * 0.085
    const tabFontString = `800 ${tabFont}px ${FONT_FAMILY}`
    const padX = size * 0.1
    const padY = size * 0.03
    const tabMetrics = measureText(this.#label, {
      font: tabFontString,
      align: 'center',
      baseline: 'middle',
      color: COLORS.background,
    })
    const tabW = tabMetrics.localW + padX * 2
    const tabH = tabMetrics.localH + padY * 2
    const tabY = size - size * 0.12 - tabH
    const tabX = this.#tabCorner === 'br' ? size - tabW : 0
    gfx.fillRect(tabX, tabY, tabW, tabH, COLORS.ink)
    gfx.fillText(this.#label, tabX + tabW / 2, tabY + tabH / 2, {
      font: tabFontString,
      align: 'center',
      baseline: 'middle',
      color: COLORS.background,
    })
  }
}

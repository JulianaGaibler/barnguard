/**
 * The readouts around a board: the move counter, the contest tallies, the
 * waiting notice, and the two chrome toggles.
 *
 * All of them are small and centred on their own transform, so the component
 * can place them from the layout rects without any of them knowing where they
 * sit.
 */
import {
  ButtonBehavior,
  easings,
  moveToward,
  Node2D,
  textAdvance,
  withAlpha,
  type Gfx2D,
} from '@src/stargazer'
import { drawPauseGlyph } from '../../../common/pauseGlyph'
import { font, numberFont } from '../../fonts'
import { ACCENT, ANIM, COLORS } from '../tuning'
import type { PlayerId } from '../types'

/** Where the two runs of a `used/max` readout sit, as one centred group. */
interface CounterLayout {
  /** Left edge of the whole group, relative to the node's origin. */
  left: number
  /** Centre of the used number, which is where its tick pop scales about. */
  usedCenter: number
  /** Left edge of the `/max` run. */
  maxLeft: number
  /** Width of the whole group. */
  total: number
}

/**
 * Lay a `used/max` readout out as one group centred on the node's origin.
 *
 * Centring the group, rather than pinning the number's right edge beside the
 * slash, is what keeps it balanced against the caption underneath: with a fixed
 * anchor the group's left edge moved with the digit count, so a single-digit
 * count sat visibly right of centre with dead space around the slash.
 *
 * Pure, because the advances it works from are only measurable against a real
 * canvas, and the arithmetic is the part worth pinning down.
 */
export function counterLayout(
  usedAdvance: number,
  maxAdvance: number,
  gap: number,
): CounterLayout {
  const total = usedAdvance + gap + maxAdvance
  const left = -total / 2
  return {
    left,
    usedCenter: left + usedAdvance / 2,
    maxLeft: left + usedAdvance + gap,
    total,
  }
}

/**
 * Moves used out of the allowance.
 *
 * Pops on every tick so a spent move is felt, and breathes in the warning color
 * once the allowance is nearly gone, which is the only warning the puzzle
 * gives.
 */
export class MoveMeterNode extends Node2D {
  #used = 0
  #max = 0
  #pop = 1
  #breathe = 0
  #size = 1

  constructor() {
    super('flood-move-meter')
    this.renderLayer = 'dynamic'
  }

  /** Scale the readout to the board it belongs to. */
  setSize(size: number): void {
    this.#size = size
  }

  set(used: number, max: number): void {
    if (used !== this.#used) this.#pop = 0
    this.#used = used
    this.#max = max
  }

  get warning(): boolean {
    return this.#max - this.#used <= ANIM.lowMovesWarn
  }

  override onUpdate(dt: number): void {
    if (this.#pop < 1) this.#pop = Math.min(1, this.#pop + dt / ANIM.counterPop)
    this.#breathe = this.warning
      ? (this.#breathe + dt / ANIM.counterBreathe) % 1
      : 0
  }

  override draw(gfx: Gfx2D): void {
    const s = this.#size
    // A brief overshoot on the tick, settling back to rest.
    const scale = 1 + 0.16 * (1 - easings.outCubic(this.#pop))
    const glow = this.warning
      ? 0.55 + 0.45 * Math.sin(this.#breathe * Math.PI * 2)
      : 1
    const color = this.warning ? ACCENT[2] : COLORS.paper

    const usedText = `${this.#used}`
    const maxText = `/${this.#max}`
    // Measured at the resting size, not the popped one, so the tick does not
    // shove the layout sideways every time the count changes.
    const usedFont = numberFont(700, s)
    const maxFont = numberFont(500, s * 0.62)
    const gap = s * 0.05
    const usedAdvance = textAdvance(usedText, usedFont)
    const maxAdvance = textAdvance(maxText, maxFont)
    // `textAdvance`, not `textWidth`: the latter is the label's bitmap box, and
    // stepping one run past another by it leaves a gap.
    const group = counterLayout(usedAdvance, maxAdvance, gap)
    // Digits sit on a baseline rather than centred on their em box, which for a
    // numeral face is most of the way to the cap height.
    const baseline = s * 0.35

    gfx.setAlpha(glow)
    gfx.fillText(usedText, group.usedCenter, baseline, {
      font: numberFont(700, s * scale),
      align: 'center',
      baseline: 'alphabetic',
      color,
    })
    gfx.setAlpha(0.5)
    gfx.fillText(maxText, group.maxLeft, baseline, {
      font: maxFont,
      align: 'left',
      baseline: 'alphabetic',
      color: COLORS.paper,
    })
    gfx.setAlpha(1)
    gfx.fillText('MOVES', 0, s * 0.72, {
      font: font(700, s * 0.3),
      align: 'center',
      baseline: 'middle',
      color: withAlpha(COLORS.paper, 0.5),
    })
  }
}

/**
 * One player's cell count in the contest, with a marker while it is their turn.
 *
 * The turn has to be unmistakable at booth distance, so it is carried by three
 * things at once: the accent bar, the label, and the swatch row brightening.
 */
/** Seconds for a tally to fade between its idle and active look. */
const ACTIVE_FADE = 0.22

export class TallyNode extends Node2D {
  readonly #player: PlayerId
  readonly #label: string
  #count = 0
  #size = 1
  #active = false
  #activeT = 0

  constructor(player: PlayerId, label: string) {
    super(`flood-tally-${player}`)
    this.#player = player
    this.#label = label
    this.renderLayer = 'dynamic'
  }

  setSize(size: number): void {
    this.#size = size
  }

  set(count: number): void {
    this.#count = count
  }

  setActive(active: boolean): void {
    this.#active = active
  }

  override onUpdate(dt: number): void {
    const target = this.#active ? 1 : 0
    this.#activeT = moveToward(this.#activeT, target, dt / ACTIVE_FADE)
  }

  override draw(gfx: Gfx2D): void {
    const s = this.#size
    const accent = ACCENT[this.#player]
    const lift = easings.outCubic(this.#activeT)

    // Stacked and centred on its own transform, so it sits square in the narrow
    // strip beside the board rather than running off one side of it.
    gfx.setAlpha(0.4 + 0.6 * lift)
    gfx.fillText(this.#label, 0, -s * 0.52, {
      font: font(700, s * 0.26),
      align: 'center',
      baseline: 'middle',
      color: accent,
    })
    gfx.setAlpha(0.6 + 0.4 * lift)
    gfx.fillText(`${this.#count}`, 0, -s * 0.05, {
      font: numberFont(700, s * 0.62),
      align: 'center',
      baseline: 'middle',
      color: COLORS.paper,
    })
    gfx.setAlpha(1)

    // The turn marker: a rule under the count that grows in from nothing, so
    // whose move it is reads at a glance from across the booth.
    const ruleW = s * 0.7 * lift
    if (ruleW > 0) {
      const h = s * 0.075
      gfx.fillRoundRect(-ruleW / 2, s * 0.36, ruleW, h, h / 2, accent)
    }
  }
}

/** A centered notice, for the player waiting on the other to finish. */
export class NoticeNode extends Node2D {
  #text = ''
  #size = 1
  #shown = 0

  constructor() {
    super('flood-notice')
    this.renderLayer = 'dynamic'
    this.visible = false
  }

  setSize(size: number): void {
    this.#size = size
  }

  show(text: string): void {
    this.#text = text
    this.visible = true
  }

  hide(): void {
    this.visible = false
    this.#shown = 0
  }

  override onUpdate(dt: number): void {
    if (this.visible && this.#shown < 1) {
      this.#shown = Math.min(1, this.#shown + dt / 0.3)
    }
  }

  override draw(gfx: Gfx2D): void {
    const s = this.#size
    const t = easings.outCubic(this.#shown)
    // Body face, not the display one. This is a status line rather than a
    // heading, and the heading face is set far too loud for a sentence.
    const size = s * 0.4
    const label = font(600, size)
    // The pill is measured from the text rather than guessed at a multiple of
    // the node size, which is what let a longer sentence run out of its box.
    const padX = size * 1.1
    const padY = size * 0.62
    const w = textAdvance(this.#text, label) + padX * 2
    const h = size + padY * 2

    gfx.setAlpha(t * 0.9)
    gfx.fillRoundRect(-w / 2, -h / 2, w, h, h / 2, COLORS.well)
    gfx.setAlpha(t)
    // Sat on a baseline rather than centred on the em box, so the text sits in
    // the middle of the pill by cap height.
    gfx.fillText(this.#text, 0, size * 0.35, {
      font: label,
      align: 'center',
      baseline: 'alphabetic',
      color: COLORS.paper,
    })
    gfx.setAlpha(1)
  }
}

/** What a {@link ChromeButtonNode} draws inside itself. */
type ChromeIcon = 'pause' | 'glyphs'

/**
 * A small square button in the board's chrome: pause, and the shape toggle.
 *
 * The shape toggle sits out here rather than inside the pause menu because a
 * player who needs it needs it now, and the booth remembers nothing between
 * visitors.
 */
export class ChromeButtonNode extends Node2D {
  readonly #icon: ChromeIcon
  #size = 0
  #pressed = false
  #on = false

  constructor(icon: ChromeIcon, onClick: () => void) {
    super(`flood-chrome-${icon}`)
    this.#icon = icon
    this.renderLayer = 'dynamic'
    this.addBehavior(
      new ButtonBehavior({
        onClick,
        onPressedChange: (pressed) => (this.#pressed = pressed),
      }),
    )
  }

  setSize(size: number): void {
    this.#size = size
    this.debugBounds = { x: 0, y: 0, width: size, height: size }
  }

  /** Whether the toggle reads as engaged. Ignored by the pause button. */
  setOn(on: boolean): void {
    this.#on = on
  }

  override draw(gfx: Gfx2D): void {
    const s = this.#size
    if (s <= 0) return
    const radius = s * 0.28
    const fill = this.#on ? ACCENT[1] : withAlpha(COLORS.paper, 0.08)
    const ink = this.#on ? COLORS.ink : COLORS.paper

    gfx.fillRoundRect(0, 0, s, s, radius, fill)
    gfx.strokeRoundRect(0, 0, s, s, radius, {
      color: withAlpha(COLORS.paper, this.#pressed ? 0.5 : 0.22),
      width: s * 0.05,
    })

    if (this.#icon === 'pause') {
      drawPauseGlyph(gfx, s / 2, s / 2, s, ink)
      return
    }

    // The shape toggle shows two of the cell glyphs, which is the clearest
    // label for what it does without any text.
    const r = s * 0.13
    gfx.fillCircle(s * 0.35, s * 0.38, r, ink)
    const tri = s * 0.14
    const pts = [
      s * 0.64,
      s * 0.5,
      s * 0.64 + tri,
      s * 0.5 + tri * 1.6,
      s * 0.64 - tri,
      s * 0.5 + tri * 1.6,
    ]
    gfx.fillConvexPoly(pts, 3, ink)
  }
}

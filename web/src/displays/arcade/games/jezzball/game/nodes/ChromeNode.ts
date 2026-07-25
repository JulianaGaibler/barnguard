/**
 * Purely decorative frame chrome, ported from CSS to the engine so it's one
 * fewer always-mounted DOM overlay: two full-width top/bottom bars, four
 * rounded "tab" pills, and four corner marks (a rotating "+" plus two hollow
 * squares). Every size below is a CSS-pixel value converted to world units
 * via `camera.strokeSpaceScale()` each frame, so it reads at a constant
 * on-screen size regardless of the canvas' actual resolution — matching how
 * the original absolutely-positioned DOM version behaved.
 */
import { SceneNode, easings, type Camera, type Gfx2D } from '@src/stargazer'
import type { Bounds } from '../types'
import { COLORS } from '../tuning'

const PADDING_PX = 25.6 // 1.6rem
const GAP_PX = 16 // 1rem
const PLUS_SIZE_PX = 35.2 // 2.2rem
const PLUS_THICKNESS_PX = 2
const SQUARE_SIZE_PX = 11.2 // 0.7rem
const SQUARE_BORDER_PX = 2
const EDGE_HEIGHT_PX = 10
const TAB_WIDTH_PX = 208 // 13rem
const TAB_HEIGHT_PX = 22.4 // 1.4rem
const TAB_RADIUS_PX = 12.8 // 0.8rem
const TAB_INSET_FRAC = 0.15

/** Each corner's `+` free-runs on its own loop so all four don't snap in
 * unison — durations/delays (seconds) match the original CSS animation. */
const CORNERS = [
  { h: 'left', v: 'top', duration: 13, delay: 0 },
  { h: 'right', v: 'top', duration: 17, delay: 6 },
  { h: 'left', v: 'bottom', duration: 19, delay: 3 },
  { h: 'right', v: 'bottom', duration: 15, delay: 9 },
] as const

/**
 * The `+`'s rotation over one cycle: mostly still, with a quick quarter-turn
 * snap between holds (an 18%-hold/7%-turn split per quarter, four times a
 * cycle) — ported from the original `@keyframes jb-quarter`, whose keyframes
 * ease (the CSS default) rather than move linearly, hence `inOutCubic` on the
 * turn itself. A symmetric `+` looks identical at every 90° multiple, so the
 * only visible moment is the brief mid-turn flicker to an "X".
 */
function quarterTurnAngle(elapsed: number, duration: number, delay: number): number {
  const t = elapsed - delay
  if (t <= 0) return 0
  const quarter = duration / 4
  const cycle = t % duration
  const index = Math.floor(cycle / quarter)
  const local = (cycle - index * quarter) / quarter
  const HOLD_FRAC = 0.72 // 18% hold + 7% turn per 25%-of-cycle quarter
  const deg =
    local < HOLD_FRAC
      ? index * 90
      : index * 90 + easings.inOutCubic((local - HOLD_FRAC) / (1 - HOLD_FRAC)) * 90
  return (deg * Math.PI) / 180
}

export class ChromeNode extends SceneNode {
  #rect: Bounds
  #elapsed = 0

  constructor(rect: Bounds) {
    super('jezzball-chrome')
    this.#rect = rect
    this.renderLayer = 'dynamic'
  }

  setRect(rect: Bounds): void {
    this.#rect = rect
  }

  override onUpdate(dt: number): void {
    this.#elapsed += dt
  }

  override draw(gfx: Gfx2D, camera: Camera): void {
    const s = camera.strokeSpaceScale()
    const r = this.#rect
    const color = COLORS.ink

    const edgeH = EDGE_HEIGHT_PX * s
    gfx.fillRect(r.x, r.y, r.width, edgeH, color)
    gfx.fillRect(r.x, r.y + r.height - edgeH, r.width, edgeH, color)

    const tabW = TAB_WIDTH_PX * s
    const tabH = TAB_HEIGHT_PX * s
    const tabR = TAB_RADIUS_PX * s
    const inset = r.width * TAB_INSET_FRAC
    const topRadii: [number, number, number, number] = [0, 0, tabR, tabR]
    const botRadii: [number, number, number, number] = [tabR, tabR, 0, 0]
    gfx.fillRoundRect(r.x + inset, r.y, tabW, tabH, topRadii, color)
    gfx.fillRoundRect(r.x + r.width - inset - tabW, r.y, tabW, tabH, topRadii, color)
    gfx.fillRoundRect(r.x + inset, r.y + r.height - tabH, tabW, tabH, botRadii, color)
    gfx.fillRoundRect(
      r.x + r.width - inset - tabW,
      r.y + r.height - tabH,
      tabW,
      tabH,
      botRadii,
      color,
    )

    const pad = PADDING_PX * s
    const gap = GAP_PX * s
    const plusSize = PLUS_SIZE_PX * s
    const sqSize = SQUARE_SIZE_PX * s
    const thick = PLUS_THICKNESS_PX * s
    const border = { color, width: SQUARE_BORDER_PX * s }

    for (const c of CORNERS) {
      const dir = c.h === 'left' ? 1 : -1
      const edgeX = c.h === 'left' ? r.x + pad : r.x + r.width - pad
      const rowY =
        c.v === 'top' ? r.y + pad + plusSize / 2 : r.y + r.height - pad - plusSize / 2

      // Row of 3 items (plus, then two squares), growing inward from `edgeX`.
      let cursor = edgeX
      const nextCenter = (size: number): number => {
        const center = cursor + dir * (size / 2)
        cursor += dir * (size + gap)
        return center
      }
      const plusX = nextCenter(plusSize)
      const sq1X = nextCenter(sqSize)
      const sq2X = nextCenter(sqSize)

      gfx.save()
      gfx.translate(plusX, rowY)
      gfx.rotate(quarterTurnAngle(this.#elapsed, c.duration, c.delay))
      gfx.fillRect(-plusSize / 2, -thick / 2, plusSize, thick, color)
      gfx.fillRect(-thick / 2, -plusSize / 2, thick, plusSize, color)
      gfx.restore()

      gfx.strokeRoundRect(sq1X - sqSize / 2, rowY - sqSize / 2, sqSize, sqSize, 0, border)
      gfx.strokeRoundRect(sq2X - sqSize / 2, rowY - sqSize / 2, sqSize, sqSize, 0, border)
    }
  }
}

// Active-pointer marker overlay for the debug HUD. Pure function of the
// input system's live pointers, no controller state.

import type { InputSystem } from '../input/InputSystem'
import type { Gfx2D } from '../render/gfx/Gfx2D'

/**
 * Palette rotated by `pointerId % length` for the pointer overlay. Each entry
 * is a `[stroke, fill]` pair so we don't recompute alpha strings per frame.
 */
const POINTER_PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#60a5fa', 'rgba(96, 165, 250, 0.2)'],
  ['#c084fc', 'rgba(192, 132, 252, 0.2)'],
  ['#4ade80', 'rgba(74, 222, 128, 0.2)'],
  ['#fbbf24', 'rgba(251, 191, 36, 0.2)'],
  ['#f87171', 'rgba(248, 113, 113, 0.2)'],
  ['#fb923c', 'rgba(251, 146, 60, 0.2)'],
]

/**
 * Draw a marker at each active pointer's screen position with its pointer ID
 * and kind. Called by `DebugController.drawInputOverlay` per stage, so a finger
 * on the secondary card gets markers on the secondary canvas.
 */
export function drawPointerOverlay(gfx: Gfx2D, input: InputSystem): void {
  const pointers = input.pointers
  if (pointers.size === 0) return

  const slop = input.touchSlopScreen
  const radius = Math.max(20, slop)

  for (const p of pointers.values()) {
    const idx = Math.abs(p.id) % POINTER_PALETTE.length
    const [stroke, fill] = POINTER_PALETTE[idx]
    gfx.fillCircle(p.screen.x, p.screen.y, radius, fill)
    gfx.strokeCircle(p.screen.x, p.screen.y, radius, {
      color: stroke,
      width: 2,
    })
    gfx.fillCircle(p.screen.x, p.screen.y, 3, stroke)

    const label = `#${p.id} ${p.kind}`
    const tx = p.screen.x + radius + 6
    const ty = p.screen.y
    gfx.fillText(label, tx, ty, {
      font: '11px "SF Mono", "Monaco", "Roboto Mono", "Courier New", monospace',
      align: 'left',
      baseline: 'middle',
      color: '#fff',
    })
  }
}

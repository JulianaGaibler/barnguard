// World-space grid overlay for the debug HUD. Pure function of camera +
// canvas size, no controller state.

import type { Camera } from '../camera/Camera'
import type { Gfx2D } from '../render/gfx/Gfx2D'

/**
 * Draw the world grid (minor/major lines + axis + coordinate labels) for the
 * visible viewport. Called by `DebugController.drawOverlay` when the grid
 * toggle is on.
 */
export function drawGrid(
  gfx: Gfx2D,
  cam: Camera,
  canvasW: number,
  canvasH: number,
): void {
  const vp = cam.viewport
  if (vp.width <= 0 || vp.height <= 0) return

  const step = niceGridStep(vp.width)
  const subStep = step / 5

  // World range covering the entire visible canvas (includes letterbox
  // beyond the camera's fitted viewport).
  const originTL = cam.screenToWorld(0, 0)
  const originBR = cam.screenToWorld(canvasW, canvasH)
  const xLo = Math.min(originTL.x, originBR.x)
  const xHi = Math.max(originTL.x, originBR.x)
  const yLo = Math.min(originTL.y, originBR.y)
  const yHi = Math.max(originTL.y, originBR.y)

  const minor = { color: 'rgba(255, 255, 255, 0.05)', width: 1 }
  const major = { color: 'rgba(96, 165, 250, 0.25)', width: 1 }
  const axis = { color: 'rgba(255, 215, 77, 0.5)', width: 1 }

  for (let x = Math.ceil(xLo / subStep) * subStep; x <= xHi; x += subStep) {
    const sx = cam.worldToScreen(x, 0).x
    gfx.strokeLine(sx, 0, sx, canvasH, minor)
  }
  for (let y = Math.ceil(yLo / subStep) * subStep; y <= yHi; y += subStep) {
    const sy = cam.worldToScreen(0, y).y
    gfx.strokeLine(0, sy, canvasW, sy, minor)
  }
  for (let x = Math.ceil(xLo / step) * step; x <= xHi; x += step) {
    const sx = cam.worldToScreen(x, 0).x
    gfx.strokeLine(sx, 0, sx, canvasH, major)
  }
  for (let y = Math.ceil(yLo / step) * step; y <= yHi; y += step) {
    const sy = cam.worldToScreen(0, y).y
    gfx.strokeLine(0, sy, canvasW, sy, major)
  }
  if (0 >= xLo && 0 <= xHi) {
    const sx = cam.worldToScreen(0, 0).x
    gfx.strokeLine(sx, 0, sx, canvasH, axis)
  }
  if (0 >= yLo && 0 <= yHi) {
    const sy = cam.worldToScreen(0, 0).y
    gfx.strokeLine(0, sy, canvasW, sy, axis)
  }

  // Labels on major lines.
  const yAxisScreenX = cam.worldToScreen(0, 0).x
  const xAxisScreenY = cam.worldToScreen(0, 0).y
  const labelX = Math.max(2, Math.min(yAxisScreenX + 2, canvasW - 40))
  const labelY = Math.max(0, Math.min(xAxisScreenY + 2, canvasH - 14))
  const labelStyle = {
    font: '10px monospace',
    align: 'left' as const,
    baseline: 'top' as const,
    color: 'rgba(255, 255, 255, 0.55)',
  }
  for (let x = Math.ceil(xLo / step) * step; x <= xHi; x += step) {
    const sx = cam.worldToScreen(x, 0).x
    gfx.fillText(formatCoord(x), sx + 2, labelY, labelStyle)
  }
  for (let y = Math.ceil(yLo / step) * step; y <= yHi; y += step) {
    const sy = cam.worldToScreen(0, y).y
    if (Math.abs(y) < 1e-6) continue
    gfx.fillText(formatCoord(y), labelX, sy + 2, labelStyle)
  }
}

/**
 * Pick a nice round grid step so ~8-12 major lines fit across `range` world
 * units. Snaps to 1/2/5 × 10ⁿ.
 */
function niceGridStep(range: number): number {
  if (!Number.isFinite(range) || range <= 0) return 1
  const raw = range / 10
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)))
  const normalized = raw / magnitude
  let nice: number
  if (normalized < 1.5) nice = 1
  else if (normalized < 3) nice = 2
  else if (normalized < 7) nice = 5
  else nice = 10
  return nice * magnitude
}

/**
 * Compact numeric label, trims trailing fractional zeros (but never integer
 * digits) and avoids scientific notation for typical world-coord magnitudes.
 */
function formatCoord(n: number): string {
  if (Math.abs(n) < 1e-9) return '0'
  const abs = Math.abs(n)
  const decimals = abs >= 100 ? 0 : abs >= 10 ? 1 : 2
  const s = n.toFixed(decimals)
  if (s.indexOf('.') === -1) return s
  return s.replace(/0+$/, '').replace(/\.$/, '')
}

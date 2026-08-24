import { describe, expect, it } from 'vitest'
import { BANNER, BUTTONS, MOUTH } from './tuning'
import { gameVisibleRect, REGION_HEIGHT, REGION_WIDTH } from '../../../world'
import { lipTransform } from './nodes/HudNode'
import { ELEVATION } from './project'

// The bottom of the frame stacks five things in a fixed order: buttons, their
// lettering, the mouth, the lip over the mouth's lower half, and the tongue
// over the lip. Every number here is measured off `layout-bottom.png`, and the
// stack is what those numbers are FOR, so this is what catches a nudge to one
// of them that quietly buries another.

/** Screen extent of the button plate, which is a disc lying on the table. */
const PLATE_HALF = BUTTONS.baseRadius * Math.sin(ELEVATION)
const plateBottom = BUTTONS.groundY + PLATE_HALF
const mouthTop = MOUTH.centerY - MOUTH.radiusY
const mouthBottom = MOUTH.centerY + MOUTH.radiusY

/** Half-width of the mouth ellipse at a given height, or 0 outside it. */
function mouthHalfWidth(y: number): number {
  const t = (y - MOUTH.centerY) / MOUTH.radiusY
  return Math.abs(t) >= 1 ? 0 : MOUTH.radiusX * Math.sqrt(1 - t * t)
}

describe('the bottom of the frame', () => {
  it('runs the lip to the foot of the frame', () => {
    expect(BANNER.top).toBeLessThan(REGION_HEIGHT)
    expect(REGION_HEIGHT - BANNER.top).toBe(BANNER.height)
  })

  // The design region is only what the camera frames at 16:9. On anything else
  // the visible rect is wider or taller, and the lip has to follow it or it
  // stops short and leaves a band of table beside it.
  it('fills the bottom of the frame at every canvas aspect', () => {
    for (const [w, h] of [
      [1920, 1080],
      [3440, 1440],
      [2560, 1080],
      [1280, 1024],
    ]) {
      const view = gameVisibleRect(w!, h!)
      const at = lipTransform(view)
      const label = `${w}x${h}`
      expect(at.x, label).toBeLessThan(view.x)
      expect(at.x + REGION_WIDTH * at.scaleX, label).toBeGreaterThan(
        view.x + view.width,
      )
      expect(at.y + BANNER.artHeight * at.scaleY, label).toBeGreaterThan(
        view.y + view.height,
      )
      // And the top edge exactly where the art puts it.
      expect(at.y, label).toBe(BANNER.top)
    }
  })

  it('bleeds by enough to cover the hairline without moving the dip', () => {
    // The path's bottom stops short of its own height, so the bleed has to
    // clear that as well as the antialiased border.
    expect(BANNER.bleed).toBeGreaterThan(BANNER.height - BANNER.artHeight)
    expect(BANNER.bleed).toBeGreaterThanOrEqual(1)
    const at = lipTransform(gameVisibleRect(1920, 1080))
    expect(at.scaleX).toBeLessThan(1.02)
    expect(at.scaleY).toBeLessThan(1.02)
  })

  it('tucks the mouth up under the buttons', () => {
    expect(mouthTop).toBeGreaterThan(plateBottom)
    // Close under them. The gap is what reads as a face rather than as a
    // control panel with a hole below it.
    expect(mouthTop - plateBottom).toBeLessThan(60)
  })

  it('leaves the teeth above the lip and hides the rest of the mouth', () => {
    // The teeth hang from the top of the mouth, so the top has to clear the
    // lip at its highest. The bottom is meant to be swallowed by it.
    expect(mouthTop).toBeLessThan(BANNER.top)
    expect(mouthBottom).toBeGreaterThan(BANNER.top)
  })

  it('sets the lettering beside the buttons, clear of the teeth', () => {
    const half = BUTTONS.labelHeight / 2
    for (const x of [BUTTONS.labelLeftX, BUTTONS.labelRightX]) {
      // Widest a word gets at this cap height, which STAY is close to.
      const reach = BUTTONS.labelHeight * 1.6
      for (const y of [BUTTONS.labelY - half, BUTTONS.labelY + half]) {
        const clear = mouthHalfWidth(y)
        expect(
          Math.abs(x - MOUTH.centerX) - reach,
          `${x} at ${y}`,
        ).toBeGreaterThan(clear)
      }
    }
    // Outboard of its own button, not under it.
    expect(BUTTONS.labelLeftX).toBeLessThan(BUTTONS.leftX)
    expect(BUTTONS.labelRightX).toBeGreaterThan(BUTTONS.rightX)
  })

  it('hangs the tongue out of the mouth, centred on it', () => {
    const width = 373
    expect(BANNER.tongueX + width / 2).toBeCloseTo(MOUTH.centerX, 0)
    // Starts inside the mouth and runs off the bottom of the frame.
    expect(BANNER.tongueY).toBeGreaterThan(mouthTop)
    expect(BANNER.tongueY).toBeLessThan(mouthBottom)
    expect(width).toBeLessThan(mouthHalfWidth(BANNER.tongueY) * 2)
  })

  it('keeps both readouts inside the lip', () => {
    const rows = [
      BANNER.roundY,
      BANNER.totalsY,
      BANNER.totalsY + BANNER.totalHeight,
      BANNER.statusY,
      BANNER.noteY,
    ]
    for (const y of rows) {
      expect(y, `${y}`).toBeGreaterThan(BANNER.top)
      expect(y, `${y}`).toBeLessThan(REGION_HEIGHT)
    }
    expect(BANNER.margin).toBeGreaterThan(0)
    expect(BANNER.margin * 2).toBeLessThan(REGION_WIDTH)
  })
})

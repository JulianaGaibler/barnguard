import { describe, expect, it } from 'vitest'
import { chipAnchor, HudNode, type SeatHud } from './HudNode'
import { focusScreenHeight } from '../cardLayout'
import { flatForeshortening } from '../project'
import { seatPlacements } from '../seats'
import { CARD, FOCUS } from '../tuning'

/** Height of a pill, and a generous width for the column overlap check. */
const CHIP_HEIGHT = 40
const CHIP_MAX_WIDTH = 220

// A pill says whose cards those are. A hand being decided on leaves its seat
// for the middle of the frame, so a pill that stayed behind would be labelling
// an empty patch of table.

const seat = seatPlacements(5)[0]!.layout

describe('chipAnchor', () => {
  it('sits above the hand at its seat', () => {
    const at = chipAnchor(seat, false)
    expect(at.x).toBe(seat.x)
    expect(at.y).toBeLessThan(seat.y - flatForeshortening(CARD.height) / 2)
  })

  it('follows a lifted hand to the middle of the frame', () => {
    const at = chipAnchor(seat, true)
    expect(at.x).toBe(FOCUS.centerX)
    expect(at.y).toBeLessThan(FOCUS.centerY - focusScreenHeight() / 2)
  })

  it('clears the cards in both poses, and the drawn height in neither', () => {
    // A flat card and a tilted one both show far less than their drawn height,
    // so measuring against that pushes the pill up into the caption.
    for (const [lifted, hand, height] of [
      [false, seat, flatForeshortening(CARD.height)],
      [true, { x: FOCUS.centerX, y: FOCUS.centerY }, focusScreenHeight()],
    ] as const) {
      const top = hand.y - height / 2
      const gap = top - chipAnchor(hand, lifted).y
      expect(gap, `lifted ${lifted}`).toBeGreaterThan(0)
      expect(gap, `lifted ${lifted}`).toBeLessThan(CARD.height)
    }
  })

  // The readouts moved to the bottom corners, so the ceiling here is the frame
  // itself. A pill is drawn downward from its anchor, so the anchor is its top.
  it('keeps the highest seat pill on screen', () => {
    for (const count of [2, 3, 4, 5] as const) {
      for (const seat of seatPlacements(count)) {
        const at = chipAnchor(seat.layout, false)
        expect(at.y, `${count}p seat ${seat.seat}`).toBeGreaterThan(24)
      }
    }
    expect(
      chipAnchor({ x: FOCUS.centerX, y: FOCUS.centerY }, true).y,
    ).toBeGreaterThan(24)
  })

  // Three and five seats put a player at dead centre, so the lifted hand's
  // pill and that seat's own pill share a column. This is what stops the
  // focused hand drifting back up into it.
  it('clears every other seat pill in the same column', () => {
    const lifted = chipAnchor({ x: FOCUS.centerX, y: FOCUS.centerY }, true)
    for (const count of [2, 3, 4, 5] as const) {
      for (const seat of seatPlacements(count)) {
        const at = chipAnchor(seat.layout, false)
        const sameColumn = Math.abs(at.x - lifted.x) < CHIP_MAX_WIDTH
        const apart =
          at.y + CHIP_HEIGHT <= lifted.y || lifted.y + CHIP_HEIGHT <= at.y
        expect(!sameColumn || apart, `${count}p seat ${seat.seat}`).toBe(true)
      }
    }
  })
})

const seatHud = (over: Partial<SeatHud> = {}): SeatHud => ({
  seat: 0,
  label: 'One',
  total: 0,
  round: 5,
  status: 'active',
  up: false,
  ...over,
})

/** A node that has painted, so any later dirt came from a write since. */
function settled(): HudNode {
  const node = new HudNode()
  node.setSeats([seatHud()])
  node.setStatus({ seat: 0, text: 'turn', note: '' })
  node.setMatch(1, [0])
  node._paintDirty = false
  return node
}

describe('HudNode repaint', () => {
  it('ignores an equal copy of what it already shows', () => {
    const node = settled()
    node.setSeats([seatHud()])
    node.setStatus({ seat: 0, text: 'turn', note: '' })
    node.setMatch(1, [0])
    node.setViewport({ ...node.view })
    expect(node._paintDirty).toBe(false)
  })

  it('repaints when a seat, the status or the totals change', () => {
    for (const change of [
      (n: HudNode) => n.setSeats([seatHud({ up: true })]),
      (n: HudNode) => n.setStatus({ seat: 0, text: 'hit', note: '' }),
      (n: HudNode) => n.setMatch(1, [3]),
      (n: HudNode) => n.setMatch(2, [0]),
      (n: HudNode) => n.setFocusedSeat(0),
    ]) {
      const node = settled()
      change(node)
      expect(node._paintDirty).toBe(true)
    }
  })
})

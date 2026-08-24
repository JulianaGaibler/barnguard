import { describe, expect, it } from 'vitest'
import {
  SEAT_ANGLES_DEG,
  fanHalfWidth,
  fanStepFor,
  seatPlacements,
  seatSpace,
} from './seats'
import type { SeatCount } from './seats'
import { BUTTONS, CARD, CLEAR_COLUMN, SEAT_RING, SEATS, TABLE } from './tuning'
import { REGION_HEIGHT, REGION_WIDTH } from '../../../world'

// Invariants rather than coordinates: a nudged angle should stay green, and a
// layout that puts a fan under a button or off the table should not.

const COUNTS: SeatCount[] = [2, 3, 4, 5]

/** A typical hand mid-round, which is what has to fit. */
const TYPICAL_HAND = 5

describe('seatPlacements', () => {
  it('gives one placement per seat, numbered from zero', () => {
    for (const count of COUNTS) {
      const seats = seatPlacements(count)
      expect(seats).toHaveLength(count)
      expect(seats.map((s) => s.seat)).toEqual([...Array(count).keys()])
    }
  })

  it('never seats more players than there are identities', () => {
    expect(Math.max(...COUNTS)).toBeLessThanOrEqual(SEATS.length)
  })

  it('runs left to right in a stable order', () => {
    for (const count of COUNTS) {
      const xs = seatPlacements(count).map((s) => s.layout.x)
      const sorted = [...xs].sort((a, b) => b - a)
      expect(xs).toEqual(sorted)
    }
  })

  // The table is one unbroken surface wider than the frame, so fitting on it
  // says nothing. Being visible is the assertion that matters.
  it('keeps every fan inside the visible region', () => {
    const half = fanHalfWidth(TYPICAL_HAND)
    const halfHeight = CARD.height / 2
    for (const count of COUNTS) {
      for (const seat of seatPlacements(count)) {
        const { x, y } = seat.layout
        const where = `${count}p seat ${seat.seat}`
        expect(x - half, `${where} left`).toBeGreaterThanOrEqual(0)
        expect(x + half, `${where} right`).toBeLessThanOrEqual(REGION_WIDTH)
        expect(y - halfHeight, `${where} top`).toBeGreaterThanOrEqual(0)
        expect(y + halfHeight, `${where} bottom`).toBeLessThanOrEqual(
          REGION_HEIGHT,
        )
      }
    }
  })

  // The buttons own the middle of the bottom, not the whole width of it, so a
  // seat down the side may sit lower than one above them.
  it('keeps every fan clear of the buttons', () => {
    const half = fanHalfWidth(TYPICAL_HAND)
    const top = BUTTONS.groundY - BUTTONS.radius
    const left = BUTTONS.leftX - BUTTONS.baseRadius - half
    const right = BUTTONS.rightX + BUTTONS.baseRadius + half
    for (const count of COUNTS) {
      for (const seat of seatPlacements(count)) {
        const { x, y } = seat.layout
        const overlaps = x > left && x < right
        const where = `${count}p seat ${seat.seat}`
        if (overlaps) expect(y + CARD.height / 2, where).toBeLessThan(top)
        // Nothing may reach the lettering or the mouth, wherever it sits.
        expect(y + CARD.height / 2, where).toBeLessThan(BUTTONS.labelY - 40)
      }
    }
  })

  it('does not overlap two fans', () => {
    const half = fanHalfWidth(TYPICAL_HAND)
    for (const count of COUNTS) {
      const seats = seatPlacements(count)
      for (let i = 1; i < seats.length; i++) {
        const right = seats[i - 1]!.layout
        const left = seats[i]!.layout
        const gap = right.x - left.x
        const needed = 2 * half
        // Fans may overlap horizontally only if they are far apart in depth.
        const depthGap = Math.abs(right.y - left.y)
        expect(
          gap >= needed || depthGap >= CARD.height,
          `${count}p seats ${i - 1} and ${i}`,
        ).toBe(true)
      }
    }
  })

  it('seats two players opposite each other across the table', () => {
    const [right, left] = seatPlacements(2)
    expect(right!.layout.x - TABLE.centerX).toBeCloseTo(
      TABLE.centerX - left!.layout.x,
      6,
    )
    expect(right!.layout.y).toBeCloseTo(left!.layout.y, 6)
  })

  // The reason the odd counts are not symmetric. Any symmetric arrangement of
  // an odd number of seats puts one of them at top dead centre, which is the
  // middle of the stage, so three and five sit two-and-one and three-and-two.
  it('leaves the stage down the middle clear of every hand', () => {
    for (const count of COUNTS) {
      for (const seat of seatPlacements(count)) {
        const half = fanHalfWidth(
          TYPICAL_HAND,
          fanStepFor(TYPICAL_HAND, seatSpace(count, seat.seat)),
        )
        const inner = Math.abs(seat.layout.x - TABLE.centerX) - half
        expect(inner, `${count}p seat ${seat.seat}`).toBeGreaterThanOrEqual(
          CLEAR_COLUMN,
        )
      }
    }
  })

  it('gives every seat a place on the ring', () => {
    for (const count of COUNTS) {
      expect(SEAT_ANGLES_DEG[count]).toHaveLength(count)
      for (const seat of seatPlacements(count)) {
        const dx = (seat.layout.x - SEAT_RING.centerX) / SEAT_RING.radiusX
        const dy = (seat.layout.y - SEAT_RING.centerY) / SEAT_RING.radiusY
        expect(dx * dx + dy * dy, `${count}p seat ${seat.seat}`).toBeCloseTo(
          1,
          6,
        )
      }
    }
  })

  it('puts the anchors on the table plane', () => {
    for (const seat of seatPlacements(5)) {
      expect(seat.anchor.y).toBe(0)
    }
  })
})

describe('fanHalfWidth', () => {
  it('is half a card at one card', () => {
    expect(fanHalfWidth(1)).toBe(CARD.width / 2)
  })

  it('grows by the fan step per extra card', () => {
    expect(fanHalfWidth(3) - fanHalfWidth(2)).toBeCloseTo(CARD.fanStep / 2, 6)
  })

  it('does not go below one card for an empty seat', () => {
    expect(fanHalfWidth(0)).toBe(CARD.width / 2)
  })
})

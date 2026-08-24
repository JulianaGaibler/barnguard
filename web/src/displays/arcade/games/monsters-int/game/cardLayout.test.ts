import { describe, expect, it } from 'vitest'
import {
  fanPose,
  focusPose,
  modifierPose,
  mouthPose,
  REVEAL,
  revealPose,
} from './cardLayout'
import {
  ELEVATION,
  PX_TO_M,
  groundFromLayout,
  layoutFromWorld,
} from './project'
import { seatPlacements, seatSpace } from './seats'
import { BUTTONS, CARD, FOCUS } from './tuning'
import { REGION_WIDTH } from '../../../world'

// The two poses that get held up are the ones worth pinning. Both trade height
// against depth so the pair cancels on screen, and a mistake in either half
// moves the card without looking like it should have.

/**
 * How far in front of the table plane a pose sits, along the camera's own axis.
 *
 * This is what the fog reads, and what decides whether the foreground is inside
 * the haze or in front of it.
 */
function towardCamera(pose: { y: number; z: number }): number {
  return pose.y * Math.sin(ELEVATION) + pose.z * Math.cos(ELEVATION)
}

describe('revealPose', () => {
  it('faces the camera, so the art is not foreshortened', () => {
    expect(revealPose().facing).toBe('upright')
  })

  it('lands its centre where the layout puts it', () => {
    const at = layoutFromWorld(revealPose())
    expect(at.x).toBeCloseTo(REVEAL.x, 6)
    expect(at.y).toBeCloseTo(REVEAL.y, 6)
  })

  it('is held toward the camera, clear of the haze over the table', () => {
    const onTable = groundFromLayout(REVEAL.x, REVEAL.y)
    expect(towardCamera(revealPose())).toBeGreaterThan(towardCamera(onTable))
  })
})

describe('fanPose', () => {
  const seat = seatPlacements(4)[1]!
  const space = seatSpace(4, 1)

  it('lies flat on the table', () => {
    const pose = fanPose(seat, 0, 3, space)
    expect(pose.facing).toBe('flat')
    expect(pose.y).toBeGreaterThan(0)
  })

  // A hand square to the frame reads as a diagram. The angles have to be the
  // same every pass, though: a hand is re-placed whenever anything happens, and
  // a card that picked a new one each time would twitch on the table.
  it('turns each card a few degrees off square, and keeps that angle', () => {
    const limit = (CARD.spread * Math.PI) / 180
    const angles = [0, 1, 2, 3].map((i) => fanPose(seat, i, 4, space).spin ?? 0)
    for (const a of angles) expect(Math.abs(a)).toBeLessThanOrEqual(limit)
    expect(angles.some((a) => a !== 0)).toBe(true)
    expect(fanPose(seat, 2, 4, space).spin).toBe(angles[2])
  })

  it('centres the fan on the seat, however many cards it holds', () => {
    for (const count of [1, 3, 6]) {
      const first = fanPose(seat, 0, count, space)
      const last = fanPose(seat, count - 1, count, space)
      const mid = (first.x + last.x) / 2
      expect(mid, `${count} cards`).toBeCloseTo(seat.anchor.x, 9)
    }
  })

  it('lifts each card above the one before, so the fan depth-sorts', () => {
    expect(fanPose(seat, 1, 3, space).y).toBeGreaterThan(
      fanPose(seat, 0, 3, space).y,
    )
  })
})

describe('the fan adapting to its space', () => {
  it('lies unfolded when the hand has room', () => {
    const seat = seatPlacements(2)[0]!
    const space = seatSpace(2, 0)
    const a = fanPose(seat, 0, 2, space)
    const b = fanPose(seat, 1, 2, space)
    // Far enough apart that neither card covers the other.
    expect(Math.abs(b.x - a.x)).toBeGreaterThanOrEqual(
      CARD.width * PX_TO_M * 0.95,
    )
  })

  it('tightens the step rather than overflowing when the hand grows', () => {
    const seat = seatPlacements(5)[0]!
    const space = seatSpace(5, 0)
    const step = (count: number): number =>
      Math.abs(
        fanPose(seat, 1, count, space).x - fanPose(seat, 0, count, space).x,
      )
    const spread = (count: number): number =>
      Math.abs(
        fanPose(seat, count - 1, count, space).x -
          fanPose(seat, 0, count, space).x,
      )

    // A hand that already fills its width packs closer as it grows rather than
    // reaching further, so the total stays put and the step is what gives.
    expect(step(7)).toBeLessThan(step(3))
    expect(spread(7)).toBeLessThanOrEqual(space * PX_TO_M + 1e-9)
  })

  it('never packs so tight the hand stops being countable', () => {
    const seat = seatPlacements(5)[0]!
    const space = seatSpace(5, 0)
    const step = Math.abs(
      fanPose(seat, 1, 12, space).x - fanPose(seat, 0, 12, space).x,
    )
    expect(step).toBeGreaterThanOrEqual(CARD.minStep * PX_TO_M - 1e-9)
  })

  // The outer seats sit in the same place at every count, so what decides a
  // hand's room is not the count but where the seat is: hard against the frame,
  // or with the stage on one side and open table on the other.
  it('gives a seat against the frame edge less room than one in open table', () => {
    expect(seatSpace(5, 0)).toBeLessThan(seatSpace(5, 1))
  })
})

describe('focusPose', () => {
  it('keeps even a full hand inside the frame', () => {
    for (const cards of [1, 4, 7, 12]) {
      const xs = Array.from(
        { length: cards },
        (_, i) => layoutFromWorld({ x: focusPose(i, cards).x, y: 0, z: 0 }).x,
      )
      const half = (CARD.width * FOCUS.scale) / 2
      const where = `${cards} cards`
      expect(Math.min(...xs) - half, where).toBeGreaterThan(0)
      expect(Math.max(...xs) + half, where).toBeLessThan(REGION_WIDTH)
    }
  })

  it('centres on the frame, wherever its owner is sitting', () => {
    for (const cards of [1, 3, 6]) {
      const xs = Array.from(
        { length: cards },
        (_, i) => layoutFromWorld({ x: focusPose(i, cards).x, y: 0, z: 0 }).x,
      )
      expect((Math.min(...xs) + Math.max(...xs)) / 2, `${cards}`).toBeCloseTo(
        FOCUS.centerX,
        6,
      )
    }
  })

  // The table is crowded at five seats, so the focused hand cannot find a band
  // of its own. It is held well above the surface instead, which puts it in
  // front of both the hands it crosses and the haze they sit in.
  it('is held toward the camera, clear of the haze over the table', () => {
    const onTable = groundFromLayout(FOCUS.centerX, FOCUS.centerY)
    expect(towardCamera(focusPose(0, 1))).toBeGreaterThan(towardCamera(onTable))
  })

  it('lands where the layout puts it, however far it is held up', () => {
    expect(layoutFromWorld(focusPose(0, 1)).y).toBeCloseTo(FOCUS.centerY, 6)
  })

  it('sits above the buttons rather than over them', () => {
    expect(FOCUS.centerY).toBeLessThan(BUTTONS.groundY - BUTTONS.baseRadius)
  })

  it('tilts up and draws smaller, so a full hand fits where everyone looks', () => {
    expect(focusPose(0, 3).facing).toBe('tilted')
    expect(focusPose(0, 3).scale).toBeLessThan(1)
  })

  it('unfolds a small hand rather than packing it', () => {
    const gap = Math.abs(focusPose(1, 2).x - focusPose(0, 2).x)
    expect(gap).toBeGreaterThanOrEqual(CARD.width * FOCUS.scale * PX_TO_M)
  })
})

describe('modifierPose', () => {
  const seat = seatPlacements(4)[1]!

  // Below rather than above, so a modifier never shares space with the seat's
  // score pill.
  it('sits apart from the numbers, in front of the hand', () => {
    const number = fanPose(seat, 0, 1, seatSpace(4, 1))
    const modifier = modifierPose(seat, 0, 1)
    expect(modifier.z).toBeGreaterThan(number.z)
    expect(layoutFromWorld(modifier).y).toBeGreaterThan(
      layoutFromWorld(number).y + (CARD.height * Math.sin(ELEVATION)) / 2,
    )
  })

  it('draws smaller, since a modifier is read as a total not a set', () => {
    expect(modifierPose(seat, 0, 1).scale).toBeLessThan(1)
  })
})

// The table is crowded at five seats and both held-up poses cross the hands
// under them. Nothing is arranged to avoid that: depth is what resolves it, so
// depth is what gets asserted.
describe('what is held up draws over what is not', () => {
  const seats = seatPlacements(5)

  it('puts the focused hand in front of every seat', () => {
    const focus = towardCamera(focusPose(0, 1))
    for (const seat of seats) {
      const rest = fanPose(seat, 0, 1, seatSpace(5, seat.seat))
      expect(focus, `seat ${seat.seat}`).toBeGreaterThan(towardCamera(rest))
    }
  })

  it('puts the card just drawn in front of the focused hand', () => {
    expect(towardCamera(revealPose())).toBeGreaterThan(
      towardCamera(focusPose(0, 1)),
    )
  })
})

describe('mouthPose', () => {
  it('starts a card inside the mouth, below the buttons', () => {
    const at = layoutFromWorld({ x: mouthPose().x, y: 0, z: mouthPose().z })
    expect(at.y).toBeGreaterThan(BUTTONS.groundY)
  })
})

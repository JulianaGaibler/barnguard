import { describe, it, expect, beforeEach } from 'vitest'
import { get } from 'svelte/store'
import { skyTimeOverride, skyTopColor } from './uiState'
import {
  effectiveElevationDeg,
  paletteAt,
  zonedClockMinutes,
  zonedMinutesToEpochMs,
} from './background/dayCycle'
import { NIGHT, NOON } from './background/palette'

const BERLIN = { latDeg: 52.52, lonDeg: 13.405, timeZone: 'Europe/Berlin' }

describe('sky stores', () => {
  beforeEach(() => skyTimeOverride.set(null))

  it('seeds a usable color at module load', () => {
    // The seed runs a full solar evaluation at import time, so a throw here
    // would take the whole display down before the engine starts.
    expect(get(skyTopColor)).toMatch(/^rgba\(\d+, \d+, \d+, [\d.]+\)$/)
  })

  it('follows the sun until an attendant pins it', () => {
    expect(get(skyTimeOverride)).toBeNull()
  })
})

describe('the attendant slider position', () => {
  it('round-trips a clock reading through an instant', () => {
    for (const minutes of [0, 315, 720, 1230, 1435]) {
      const at = zonedMinutesToEpochMs(minutes, BERLIN.timeZone)
      expect(zonedClockMinutes(at, BERLIN.timeZone)).toBe(minutes)
    }
  })

  it('scrubs from night through noon and back over one midsummer day', () => {
    // Midsummer, so the slider can reach every palette in the list.
    const midsummer = Date.parse('2026-06-21T12:00:00Z')
    const at = (m: number) =>
      paletteAt(
        effectiveElevationDeg(
          zonedMinutesToEpochMs(m, BERLIN.timeZone, midsummer),
          BERLIN,
        ),
      )
    expect(at(2 * 60)).toBe(NIGHT)
    expect(at(13 * 60)).toBe(NOON)
    expect(at(23 * 60)).toBe(NIGHT)
  })

  it('never reaches noon on the shortest day', () => {
    const midwinter = Date.parse('2026-12-21T12:00:00Z')
    for (let m = 0; m < 1440; m += 5) {
      const p = paletteAt(
        effectiveElevationDeg(
          zonedMinutesToEpochMs(m, BERLIN.timeZone, midwinter),
          BERLIN,
        ),
      )
      expect(p).not.toBe(NOON)
    }
  })
})

import { describe, it, expect } from 'vitest'
import {
  DAY_CYCLE,
  effectiveElevationDeg,
  paletteAt,
  referencePeakDeg,
  zonedWallClockToEpochMs,
} from './dayCycle'
import { NIGHT, NOON, SUNSET, type SkyPalette } from './palette'

const BERLIN = DAY_CYCLE.fallbackLocation
/**
 * The largest driver value across a day. Solar noon drifts against the clock
 * with the season, so a fixed wall-clock hour is not the day's peak.
 */
function peakDriveOfDay(iso: string, fullDayPeakDeg?: number): number {
  const midnight = Date.parse(`${iso}T00:00:00Z`)
  let peak = -Infinity
  for (let minute = 0; minute < 1440; minute++) {
    const drive = effectiveElevationDeg(
      midnight + minute * 60_000,
      BERLIN,
      fullDayPeakDeg,
    )
    if (drive > peak) peak = drive
  }
  return peak
}

describe('DAY_CYCLE.stops', () => {
  it('is sorted by ascending elevation', () => {
    const degs = DAY_CYCLE.stops.map((s) => s.sunDeg)
    expect(degs).toEqual([...degs].sort((a, b) => a - b))
  })

  it('spans astronomical night through the horizon', () => {
    expect(DAY_CYCLE.stops[0].sunDeg).toBeLessThanOrEqual(-18)
    expect(DAY_CYCLE.stops[DAY_CYCLE.stops.length - 1].sunDeg).toBeGreaterThan(
      0,
    )
  })

  it('uses palettes that share one stop-count shape', () => {
    // `lerpPalette` pairs stops by index and silently keeps the first palette's
    // values for any the second is missing.
    const shape = (p: SkyPalette) => [
      p.oceanGlow.stops.length,
      p.cloud1.stops.length,
      p.cloud2.stops.length,
    ]
    for (const { palette } of DAY_CYCLE.stops) {
      expect(shape(palette)).toEqual(shape(SUNSET))
    }
  })
})

describe('paletteAt', () => {
  it('returns the end palettes by reference outside the range', () => {
    // Reference equality is what keeps the gradient LUT cache quiet.
    expect(paletteAt(-40)).toBe(NIGHT)
    expect(paletteAt(90)).toBe(NOON)
  })

  it('returns a stop palette by reference on a plateau', () => {
    // Reference equality is what keeps the LUT cache quiet, so every run of
    // stops sharing a palette has to hand back that same object. Derived from
    // the stop list rather than fixed angles, so retuning cannot silently drop
    // the guarantee.
    const runs = DAY_CYCLE.stops.filter(
      (stop, i) => i > 0 && DAY_CYCLE.stops[i - 1].palette === stop.palette,
    )
    expect(runs.length).toBeGreaterThan(0)
    for (const stop of runs) {
      const from = DAY_CYCLE.stops[DAY_CYCLE.stops.indexOf(stop) - 1]
      expect(paletteAt((from.sunDeg + stop.sunDeg) / 2)).toBe(stop.palette)
    }
  })

  it('blends halfway between two different bracketing stops', () => {
    const pair = DAY_CYCLE.stops.findIndex(
      (stop, i) => i > 0 && DAY_CYCLE.stops[i - 1].palette !== stop.palette,
    )
    const from = DAY_CYCLE.stops[pair - 1]
    const to = DAY_CYCLE.stops[pair]
    const mid = paletteAt((from.sunDeg + to.sunDeg) / 2)
    expect(mid).not.toBe(from.palette)
    expect(mid).not.toBe(to.palette)
    expect(mid.skyTop[0]).toBeCloseTo(
      (from.palette.skyTop[0] + to.palette.skyTop[0]) / 2,
      5,
    )
  })

  it('has no discontinuity where two stops meet', () => {
    // Sunset is the reddest palette, so no channel runs monotonically end to
    // end. What must hold is that the blend joins up, since a step at a
    // boundary would show as a pop in the sky.
    const epsilon = 1e-6
    for (const stop of DAY_CYCLE.stops) {
      const before = paletteAt(stop.sunDeg - epsilon).skyTop
      const after = paletteAt(stop.sunDeg + epsilon).skyTop
      for (let channel = 0; channel < 3; channel++) {
        expect(after[channel]).toBeCloseTo(before[channel], 2)
      }
    }
  })
})

describe('effectiveElevationDeg', () => {
  it('leaves the sun below the horizon untouched', () => {
    // Berlin at 02:00 in January is well into the night.
    const t = zonedWallClockToEpochMs(2026, 1, 15, 2, 0, BERLIN.timeZone)
    const drive = effectiveElevationDeg(t, BERLIN)
    expect(drive).toBeLessThan(-10)
    expect(effectiveElevationDeg(t, BERLIN, 0)).toBeCloseTo(drive, 10)
  })

  it('lifts a winter peak partway toward the noon stop', () => {
    const drive = peakDriveOfDay('2026-12-21')
    expect(drive).toBeGreaterThan(30)
    expect(drive).toBeLessThan(40)
    // Short of the last stop, so December never reaches full blue.
    expect(paletteAt(drive)).not.toBe(NOON)
  })

  it('takes a summer peak to the reference peak', () => {
    const drive = peakDriveOfDay('2026-06-21')
    expect(drive).toBeCloseTo(referencePeakDeg(BERLIN.latDeg), 0)
    expect(paletteAt(drive)).toBe(NOON)
  })

  it('makes every day peak alike when fullDayPeakDeg is zero', () => {
    expect(peakDriveOfDay('2026-12-21', 0)).toBeCloseTo(
      peakDriveOfDay('2026-06-21', 0),
      0,
    )
  })

  it('leaves the true elevation alone above the reference peak', () => {
    // The threshold clamps to the reference peak, so a huge value is the same
    // as no compensation rather than a shrunk day.
    const clamped = peakDriveOfDay('2026-12-21', 1000)
    expect(clamped).toBeGreaterThan(13)
    expect(clamped).toBeLessThan(15)
    expect(clamped).toBeCloseTo(
      peakDriveOfDay('2026-12-21', referencePeakDeg(BERLIN.latDeg)),
      6,
    )
  })

  it('stays finite through a polar winter', () => {
    // Longyearbyen in December, where the day's peak is below the horizon.
    const polar = {
      latDeg: 78.22,
      lonDeg: 15.65,
      timeZone: 'Arctic/Longyearbyen',
    }
    for (let hour = 0; hour < 24; hour++) {
      const t = zonedWallClockToEpochMs(2026, 12, 21, hour, 0, polar.timeZone)
      const drive = effectiveElevationDeg(t, polar, 0)
      expect(Number.isFinite(drive)).toBe(true)
      expect(drive).toBeLessThan(0)
    }
  })
})

describe('zonedWallClockToEpochMs', () => {
  it('resolves a winter Berlin wall clock at UTC+1', () => {
    expect(zonedWallClockToEpochMs(2026, 1, 15, 12, 0, 'Europe/Berlin')).toBe(
      Date.parse('2026-01-15T11:00:00Z'),
    )
  })

  it('resolves a summer Berlin wall clock at UTC+2', () => {
    expect(zonedWallClockToEpochMs(2026, 7, 15, 12, 0, 'Europe/Berlin')).toBe(
      Date.parse('2026-07-15T10:00:00Z'),
    )
  })

  it('lands on the right side of a spring-forward boundary', () => {
    // Berlin skips 02:00 to 03:00 on 2026-03-29.
    expect(zonedWallClockToEpochMs(2026, 3, 29, 1, 30, 'Europe/Berlin')).toBe(
      Date.parse('2026-03-29T00:30:00Z'),
    )
    expect(zonedWallClockToEpochMs(2026, 3, 29, 4, 0, 'Europe/Berlin')).toBe(
      Date.parse('2026-03-29T02:00:00Z'),
    )
  })

  it('is independent of the machine timezone', () => {
    // The value depends only on the named zone, which is the whole point.
    expect(zonedWallClockToEpochMs(2026, 6, 21, 12, 0, 'UTC')).toBe(
      Date.parse('2026-06-21T12:00:00Z'),
    )
  })
})

import { describe, it, expect } from 'vitest'
import {
  MAX_DECLINATION_DEG,
  solarNoonElevationDeg,
  sunDeclinationDeg,
  sunElevationDeg,
} from './sun'

const BERLIN = { lat: 52.52, lon: 13.405 }
const MINUTE = 60_000
const DAY = 86_400_000

/** Every minute of the UTC day starting at `dayStartMs`. */
function minutesOfDay(dayStartMs: number): number[] {
  return Array.from({ length: 1440 }, (_, i) => dayStartMs + i * MINUTE)
}

describe('sunDeclinationDeg', () => {
  it('stays within the axial tilt across a year', () => {
    const start = Date.parse('2026-01-01T00:00:00Z')
    for (let day = 0; day < 365; day++) {
      const dec = sunDeclinationDeg(start + day * DAY)
      expect(Math.abs(dec)).toBeLessThanOrEqual(MAX_DECLINATION_DEG + 0.01)
    }
  })

  it('is near zero at the equinoxes and extreme at the solstices', () => {
    expect(sunDeclinationDeg(Date.parse('2026-03-20T12:00:00Z'))).toBeCloseTo(
      0,
      0,
    )
    expect(sunDeclinationDeg(Date.parse('2026-06-21T12:00:00Z'))).toBeCloseTo(
      23.44,
      0,
    )
    expect(sunDeclinationDeg(Date.parse('2026-12-21T12:00:00Z'))).toBeCloseTo(
      -23.44,
      0,
    )
  })
})

describe('sunElevationDeg', () => {
  it('stays within a quarter turn of the horizon', () => {
    for (const t of minutesOfDay(Date.parse('2026-05-04T00:00:00Z'))) {
      const e = sunElevationDeg(t, BERLIN.lat, BERLIN.lon)
      expect(e).toBeGreaterThanOrEqual(-90)
      expect(e).toBeLessThanOrEqual(90)
    }
  })

  it('peaks at the elevation the closed form predicts', () => {
    // The two functions share only the declination step, so agreeing on the
    // day's maximum cross-checks the hour angle and the elevation formula.
    for (const iso of [
      '2026-03-20',
      '2026-06-21',
      '2026-09-23',
      '2026-12-21',
    ]) {
      const start = Date.parse(`${iso}T00:00:00Z`)
      const sampled = Math.max(
        ...minutesOfDay(start).map((t) =>
          sunElevationDeg(t, BERLIN.lat, BERLIN.lon),
        ),
      )
      expect(sampled).toBeCloseTo(
        solarNoonElevationDeg(start + DAY / 2, BERLIN.lat),
        1,
      )
    }
  })

  it('reaches the known Berlin solstice noon angles', () => {
    const june = Math.max(
      ...minutesOfDay(Date.parse('2026-06-21T00:00:00Z')).map((t) =>
        sunElevationDeg(t, BERLIN.lat, BERLIN.lon),
      ),
    )
    const december = Math.max(
      ...minutesOfDay(Date.parse('2026-12-21T00:00:00Z')).map((t) =>
        sunElevationDeg(t, BERLIN.lat, BERLIN.lon),
      ),
    )
    expect(june).toBeCloseTo(60.9, 1)
    expect(december).toBeCloseTo(14.0, 1)
  })

  it('crosses the horizon twice on an equinox day', () => {
    // Geometric crossings, so these sit a few minutes inside the published
    // times, which include atmospheric refraction.
    const samples = minutesOfDay(Date.parse('2026-03-20T00:00:00Z')).map((t) =>
      sunElevationDeg(t, BERLIN.lat, BERLIN.lon),
    )
    let crossings = 0
    for (let i = 1; i < samples.length; i++) {
      if (samples[i - 1] < 0 !== samples[i] < 0) crossings++
    }
    expect(crossings).toBe(2)
  })

  it('runs continuously across a midnight boundary', () => {
    // The runtime path feeds `Date.now()` straight in and has no start-of-day
    // calculation. This holds that property.
    const around = Date.parse('2026-08-22T23:30:00Z')
    let previous = sunElevationDeg(around, BERLIN.lat, BERLIN.lon)
    for (let i = 1; i <= 60; i++) {
      const next = sunElevationDeg(around + i * MINUTE, BERLIN.lat, BERLIN.lon)
      expect(Math.abs(next - previous)).toBeLessThan(0.5)
      previous = next
    }
  })
})

describe('solarNoonElevationDeg', () => {
  it('goes negative through a polar winter', () => {
    // Longyearbyen, where the sun stays down for months.
    expect(
      solarNoonElevationDeg(Date.parse('2026-12-21T12:00:00Z'), 78.22),
    ).toBeLessThan(0)
  })

  it('tracks latitude at a fixed declination', () => {
    const solstice = Date.parse('2026-06-21T12:00:00Z')
    const equator = solarNoonElevationDeg(solstice, 0)
    const berlin = solarNoonElevationDeg(solstice, BERLIN.lat)
    expect(equator).toBeGreaterThan(berlin)
  })
})

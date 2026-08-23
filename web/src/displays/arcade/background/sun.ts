/**
 * Where the sun is, for a given instant and place on Earth.
 *
 * Everything here takes epoch milliseconds, which already denote an absolute
 * instant, so no timezone or DST handling enters the calculation. Accuracy is a
 * fraction of a degree over decades, well past what tinting a gradient needs.
 *
 * The launcher's sky reads {@link sunElevationDeg} as its driving variable. See
 * `dayCycle.ts` for how elevation maps onto palettes.
 */

import { clamp } from '@src/stargazer'

const DEG = Math.PI / 180
const MS_PER_DAY = 86_400_000

/** Days from the Unix epoch back to J2000.0, which is 2000-01-01 12:00 UTC. */
const J2000_OFFSET_DAYS = 10957.5

/**
 * Earth's axial tilt in degrees. The sun's declination swings between plus and
 * minus this value over a year, which bounds how high the sun can climb at any
 * latitude.
 */
export const MAX_DECLINATION_DEG = 23.44

function daysSinceJ2000(epochMs: number): number {
  return epochMs / MS_PER_DAY - J2000_OFFSET_DAYS
}

/** Positive remainder, unlike `%` which keeps the sign of the dividend. */
function wrap(v: number, m: number): number {
  return ((v % m) + m) % m
}

/**
 * The sun's declination and right ascension in radians, from the number of days
 * since J2000. Both public functions need the declination and only one needs
 * the right ascension, so they share this step.
 */
function equatorialCoords(n: number): { dec: number; ra: number } {
  const meanLon = (280.46 + 0.9856474 * n) * DEG
  const meanAnomaly = (357.528 + 0.9856003 * n) * DEG
  // Ecliptic longitude, carrying the two largest periodic corrections. Further
  // terms sit below a thousandth of a degree.
  const eclipticLon =
    meanLon +
    (1.915 * Math.sin(meanAnomaly) + 0.02 * Math.sin(2 * meanAnomaly)) * DEG
  const obliquity = (23.439 - 0.0000004 * n) * DEG
  return {
    dec: Math.asin(Math.sin(obliquity) * Math.sin(eclipticLon)),
    ra: Math.atan2(
      Math.cos(obliquity) * Math.sin(eclipticLon),
      Math.cos(eclipticLon),
    ),
  }
}

/**
 * The sun's declination in degrees, which is the latitude directly beneath it.
 * Positive in northern summer, and always within {@link MAX_DECLINATION_DEG} of
 * the equator.
 */
export function sunDeclinationDeg(epochMs: number): number {
  return equatorialCoords(daysSinceJ2000(epochMs)).dec / DEG
}

/**
 * The sun's angle above the horizon in degrees, negative when it has set.
 *
 * ```ts
 * sunElevationDeg(Date.now(), 52.52, 13.405) // Berlin, right now
 * ```
 *
 * Latitude is north positive and longitude is east positive. The reference
 * angles worth knowing: 0 is sunrise and sunset, -6 is civil twilight, and -18
 * is the start of astronomical night.
 */
export function sunElevationDeg(
  epochMs: number,
  latDeg: number,
  lonDeg: number,
): number {
  const n = daysSinceJ2000(epochMs)
  const { dec, ra } = equatorialCoords(n)
  // Greenwich mean sidereal time in hours. Wrapping keeps the radian conversion
  // small enough that argument reduction in cos stays precise.
  const gmstHours = wrap(18.697374558 + 24.06570982441908 * n, 24)
  const hourAngle = (gmstHours * 15 + lonDeg) * DEG - ra
  const lat = latDeg * DEG
  const sinElevation =
    Math.sin(lat) * Math.sin(dec) +
    Math.cos(lat) * Math.cos(dec) * Math.cos(hourAngle)
  return Math.asin(clamp(sinElevation, -1, 1)) / DEG
}

/**
 * The highest elevation the sun reaches on the day containing `epochMs`, which
 * it hits at solar noon. Negative through a polar winter, where the sun never
 * clears the horizon.
 *
 * This is the closed form rather than a search over the day, and it depends
 * only on the declination, which makes it an independent check on
 * {@link sunElevationDeg}.
 */
export function solarNoonElevationDeg(epochMs: number, latDeg: number): number {
  return 90 - Math.abs(latDeg - sunDeclinationDeg(epochMs))
}

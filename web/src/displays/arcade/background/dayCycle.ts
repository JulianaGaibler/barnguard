/**
 * Maps the sun's position onto the launcher's sky palette.
 *
 * The driving variable is an effective elevation in degrees. Below the horizon
 * it is the sun's true elevation, so twilight keeps its real length and timing.
 * Above the horizon it is scaled by {@link DAY_CYCLE.fullDayPeakDeg} so short
 * winter days are not stuck at sunset from dawn to dusk.
 *
 * {@link DAY_CYCLE} holds every knob. {@link paletteAt} turns a driver value into
 * a palette, reusing `lerpPalette` for the blend.
 */

import {
  NIGHT,
  NOON,
  SUNSET,
  TWILIGHT,
  lerpPalette,
  type SkyPalette,
} from './palette'
import {
  MAX_DECLINATION_DEG,
  solarNoonElevationDeg,
  sunElevationDeg,
} from './sun'

/** A palette pinned to an effective sun elevation, in degrees. */
export interface DayCycleStop {
  sunDeg: number
  palette: SkyPalette
}

export interface GeoLocation {
  /** Degrees, north positive. */
  latDeg: number
  /** Degrees, east positive. */
  lonDeg: number
  /** IANA zone name, used only to resolve wall-clock dev overrides. */
  timeZone: string
}

export const DAY_CYCLE = {
  /**
   * Used until the daemon's `[client]` config arrives over SSE, and if it never
   * does. Berlin Alexanderplatz.
   */
  fallbackLocation: {
    latDeg: 52.52,
    lonDeg: 13.405,
    timeZone: 'Europe/Berlin',
  } satisfies GeoLocation,

  /**
   * The solar-noon height, in degrees, at which a day counts as fully lit. Days
   * whose noon sun clears it reach the top of the range. Shorter days fall
   * short in proportion.
   *
   * Lower means more days count as full, so less seasonal difference. At 0
   * every day peaks identically. At or above the reference peak (about 61 in
   * Berlin) the threshold clamps and every day keeps its true elevation. At the
   * default, Berlin's December noon of 14.0 drives as 34.2, about a quarter of
   * the way from sunset to noon.
   */
  fullDayPeakDeg: 25,

  /**
   * How often the palette is recomputed. The sun moves about 0.25 degrees a
   * minute at its fastest, which at this interval is well under one 8-bit color
   * level per step. Raising it past about 15 starts to band on a gradient this
   * large.
   */
  updateSeconds: 5,

  /**
   * Effective elevation below which the launcher swaps to its dark chrome. Set
   * where the sky's own luminance crosses the point at which light ink starts
   * beating dark ink, so the switch lands with the background rather than
   * against it. `theme.test.ts` holds that relationship.
   */
  darkBelowDeg: 2,

  /**
   * Palette stops over the effective elevation. The two flat runs are what keep
   * the noon color from dominating: night holds through most of twilight,
   * sunset lingers well past sunrise, and the rest of the day sits inside the
   * long blend up to noon. Over a Berlin midsummer day that leaves about 9.7
   * hours of sunset tones against 6.9 of blue.
   *
   * The sunset stop is the strongest lever on that balance. Raising the noon
   * stop only narrows the window at the very top of the day.
   */
  stops: [
    { sunDeg: -18, palette: NIGHT }, // astronomical night
    { sunDeg: -6, palette: NIGHT }, // civil twilight
    { sunDeg: 0, palette: TWILIGHT }, // horizon, the blue hour
    { sunDeg: 10, palette: SUNSET },
    { sunDeg: 53, palette: SUNSET },
    { sunDeg: 58, palette: NOON },
  ] satisfies DayCycleStop[],
}

/**
 * The highest elevation the sun reaches anywhere in the year at `latDeg`, which
 * anchors the top of the driver's range. Derived from latitude so moving the
 * booth rescales the cycle instead of breaking it.
 */
export function referencePeakDeg(latDeg: number): number {
  // Between the tropics the sun passes directly overhead at some point in the
  // year, so the peak saturates at 90 rather than falling away again.
  return 90 - Math.max(0, Math.abs(latDeg) - MAX_DECLINATION_DEG)
}

/**
 * The booth location as the daemon reports it. Structurally typed so this
 * module stays free of the store.
 */
export function locationFromConfig(config: {
  latitude: number
  longitude: number
  timezone: string
}): GeoLocation {
  return {
    latDeg: config.latitude,
    lonDeg: config.longitude,
    timeZone: config.timezone,
  }
}

/**
 * The driver value for an instant: the sun's elevation, stretched above the
 * horizon so that a short day still climbs through the palette range.
 */
export function effectiveElevationDeg(
  epochMs: number,
  location: GeoLocation,
  fullDayPeakDeg: number = DAY_CYCLE.fullDayPeakDeg,
): number {
  const elevation = sunElevationDeg(epochMs, location.latDeg, location.lonDeg)
  if (elevation <= 0) return elevation
  // Dividing inside the branch keeps a polar winter, where the peak is at or
  // below zero, from producing a non-finite gain.
  const todaysPeak = solarNoonElevationDeg(epochMs, location.latDeg)
  const referencePeak = referencePeakDeg(location.latDeg)
  // No day ever peaks above the reference, so a larger threshold would push the
  // gain below 1 and shrink the day instead of leaving it alone.
  const threshold = Math.min(fullDayPeakDeg, referencePeak)
  return elevation * (referencePeak / Math.max(todaysPeak, threshold))
}

/**
 * The palette for a driver value, blending the two stops it falls between.
 *
 * Returns a stop's own palette by reference when the driver sits on or outside
 * that stop, which keeps the gradient LUT cache in `util.ts` from rebuilding
 * through the long night and noon plateaus.
 */
export function paletteAt(
  driveDeg: number,
  stops: readonly DayCycleStop[] = DAY_CYCLE.stops,
): SkyPalette {
  const first = stops[0]
  const last = stops[stops.length - 1]
  if (driveDeg <= first.sunDeg) return first.palette
  if (driveDeg >= last.sunDeg) return last.palette
  for (let i = 1; i < stops.length; i++) {
    const to = stops[i]
    if (driveDeg > to.sunDeg) continue
    const from = stops[i - 1]
    if (from.palette === to.palette) return to.palette
    const span = to.sunDeg - from.sunDeg
    if (span <= 0) return to.palette
    const t = (driveDeg - from.sunDeg) / span
    if (t <= 0) return from.palette
    if (t >= 1) return to.palette
    return lerpPalette(from.palette, to.palette, t)
  }
  return last.palette
}

/** What a zone's clock reads at a given instant. */
export interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

/** Break an instant into the calendar fields a zone's clock shows for it. */
export function zonedParts(epochMs: number, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(epochMs)
  const f: Record<string, string> = {}
  for (const p of parts) f[p.type] = p.value
  return {
    year: Number(f.year),
    month: Number(f.month),
    day: Number(f.day),
    // Some engines render midnight as hour 24 under `hour12: false`.
    hour: Number(f.hour) % 24,
    minute: Number(f.minute),
    second: Number(f.second),
  }
}

/**
 * Minutes past midnight on a zone's clock, in the range 0 to 1439. The
 * attendant's time-of-day slider runs in these units.
 */
export function zonedClockMinutes(epochMs: number, timeZone: string): number {
  const { hour, minute } = zonedParts(epochMs, timeZone)
  return hour * 60 + minute
}

/**
 * The zone's offset from UTC in milliseconds at a given instant. Positive east
 * of Greenwich.
 */
function zoneOffsetMs(epochMs: number, timeZone: string): number {
  const { year, month, day, hour, minute, second } = zonedParts(
    epochMs,
    timeZone,
  )
  return Date.UTC(year, month - 1, day, hour, minute, second) - epochMs
}

/**
 * The instant at which a zone's clock reads `minutes` past midnight, on the day
 * it is currently showing. Backs the attendant slider, which scrubs today
 * rather than naming a date.
 */
export function zonedMinutesToEpochMs(
  minutes: number,
  timeZone: string,
  nowMs: number = Date.now(),
): number {
  const { year, month, day } = zonedParts(nowMs, timeZone)
  return zonedWallClockToEpochMs(
    year,
    month,
    day,
    Math.floor(minutes / 60),
    minutes % 60,
    timeZone,
  )
}

/**
 * The instant at which a zone's clock reads the given wall-clock fields.
 *
 * ```ts
 * zonedWallClockToEpochMs(2026, 12, 21, 12, 0, 'Europe/Berlin')
 * ```
 *
 * Only the dev overrides need this. The running cycle reads `Date.now()`, which
 * is already absolute, so no zone enters the sky itself.
 */
export function zonedWallClockToEpochMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  // The first correction can land on the far side of a DST boundary, so the
  // offset is resolved again at the corrected instant.
  const once = guess - zoneOffsetMs(guess, timeZone)
  return guess - zoneOffsetMs(once, timeZone)
}

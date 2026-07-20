/**
 * The launcher's sky palette, codified from the reference SVGs (`arcade-bg`,
 * `arcade-ocean`, `arcade-cloud1-clip`, `arcade-cloud2-clip`) — those files are
 * never loaded; their colors/stops/positions live here as plain numbers so the
 * background can be re-tinted and **tweened** between times of day. Positions
 * are fractions of the 1920×1080 launcher region (resolution-independent).
 */

/** `[r, g, b, a]` — rgb 0..255, a 0..1. */
export type Rgba = readonly [number, number, number, number]

export interface GradientStopN {
  offset: number
  color: Rgba
}

/**
 * A radial gradient in launcher-region fractions (cx/cy of region width/height,
 * r of region width). World-fixed: clouds drift THROUGH these stationary
 * glows.
 */
export interface RadialDef {
  cx: number
  cy: number
  r: number
  stops: GradientStopN[]
}

export interface SkyPalette {
  /** Sky linear gradient endpoints (top-left → bottom-right of the world). */
  skyTop: Rgba
  skyBottom: Rgba
  /** Ocean base fill + horizon glow (radial, bright at the waterline). */
  oceanBase: Rgba
  oceanGlow: RadialDef
  /** The two drifting clouds' fixed radial gradients. */
  cloud1: RadialDef
  cloud2: RadialDef
}

/** Sunset preset — the only palette for now. Others (dawn, noon…) land later. */
export const SUNSET: SkyPalette = {
  // arcade-bg.svg: base #EAC6F2 with a pink #F6CCE1 wash toward the lower-right.
  skyTop: [234, 198, 242, 1], // #EAC6F2
  skyBottom: [246, 204, 225, 1], // #F6CCE1
  // arcade-ocean.svg: base #AD8DF0, radial glow brightening the waterline.
  oceanBase: [173, 141, 240, 1], // #AD8DF0
  oceanGlow: {
    // Centered at the waterline (cy: 0 = top of the ocean band); bright center
    // fading down/out, so the horizon glows. See OceanNode.
    cx: 0.5,
    cy: 0.0,
    r: 0.95,
    stops: [
      { offset: 0, color: [246, 204, 225, 0.52] },
      { offset: 0.55, color: [203, 166, 233, 0.35] },
      { offset: 1, color: [173, 141, 240, 0] },
    ],
  },
  // arcade-cloud1-clip.svg: warm-white radial @0.66. World-fixed, low-left, so
  // clouds light up warm as they drift across it.
  cloud1: {
    cx: 0.1,
    cy: 0.4,
    r: 0.4,
    stops: [
      { offset: 0, color: [252, 244, 241, 0.4] },
      { offset: 0.5, color: [245, 226, 241, 0.3] },
      { offset: 0.85, color: [236, 205, 241, 0.1] },
      { offset: 1, color: [234, 198, 242, 0] },
    ],
  },
  // arcade-cloud2-clip.svg: #CFB5F3 radial @0.4. World-fixed, low-right.
  cloud2: {
    cx: 1.0,
    cy: 1.0,
    r: 0.7,
    stops: [
      { offset: 0, color: [207, 181, 243, 0.5] },
      { offset: 1, color: [207, 181, 243, 0] },
    ],
  },
}

/** Format an `Rgba` tuple as a CSS `rgba(...)` string. */
export function rgbaStr(c: Rgba): string {
  return `rgba(${Math.round(c[0])}, ${Math.round(c[1])}, ${Math.round(c[2])}, ${c[3]})`
}

function lerpN(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function lerpRgba(a: Rgba, b: Rgba, t: number): Rgba {
  return [
    lerpN(a[0], b[0], t),
    lerpN(a[1], b[1], t),
    lerpN(a[2], b[2], t),
    lerpN(a[3], b[3], t),
  ]
}

function lerpStops(
  a: GradientStopN[],
  b: GradientStopN[],
  t: number,
): GradientStopN[] {
  // Assumes matching stop counts across palettes (they should share a shape).
  return a.map((s, i) => ({
    offset: lerpN(s.offset, b[i]?.offset ?? s.offset, t),
    color: lerpRgba(s.color, b[i]?.color ?? s.color, t),
  }))
}

function lerpRadial(a: RadialDef, b: RadialDef, t: number): RadialDef {
  return {
    cx: lerpN(a.cx, b.cx, t),
    cy: lerpN(a.cy, b.cy, t),
    r: lerpN(a.r, b.r, t),
    stops: lerpStops(a.stops, b.stops, t),
  }
}

/** Interpolate two palettes (for time-of-day transitions). */
export function lerpPalette(
  a: SkyPalette,
  b: SkyPalette,
  t: number,
): SkyPalette {
  return {
    skyTop: lerpRgba(a.skyTop, b.skyTop, t),
    skyBottom: lerpRgba(a.skyBottom, b.skyBottom, t),
    oceanBase: lerpRgba(a.oceanBase, b.oceanBase, t),
    oceanGlow: lerpRadial(a.oceanGlow, b.oceanGlow, t),
    cloud1: lerpRadial(a.cloud1, b.cloud1, t),
    cloud2: lerpRadial(a.cloud2, b.cloud2, t),
  }
}

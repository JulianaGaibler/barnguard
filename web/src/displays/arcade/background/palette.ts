/**
 * The launcher's sky palette, codified from the reference SVGs (`arcade-bg`,
 * `arcade-ocean`, `arcade-cloud1-clip`, `arcade-cloud2-clip`). Those files are
 * never loaded. Their colors, stops, and positions live here as plain numbers
 * so the background can be re-tinted and **tweened** between times of day.
 * Positions are fractions of the 1920×1080 launcher region
 * (resolution-independent).
 */

/** `[r, g, b, a]`, rgb 0..255, a 0..1. */
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

/**
 * The presets the day cycle blends between. They share one shape, since
 * {@link lerpPalette} pairs stops by index: `oceanGlow` has 3, `cloud1` has 4,
 * and `cloud2` has 2. A preset with a different count silently keeps the other
 * palette's values for the extra stops.
 *
 * Each radial's last stop repeats the layer's base color at zero alpha, so the
 * glow fades into the surface behind it rather than into transparency.
 */

/** Low sun, warm and pink. Serves both sunrise and sunset. */
export const SUNSET: SkyPalette = {
  // arcade-bg.svg: base #EAC6F2 with a pink #F6CCE1 wash toward the lower-right.
  skyTop: [234, 198, 242, 1], // #EAC6F2
  skyBottom: [246, 204, 225, 1], // #F6CCE1
  // arcade-ocean.svg: base #AD8DF0, radial glow brightening the waterline.
  oceanBase: [173, 141, 240, 1], // #AD8DF0
  oceanGlow: {
    // Centered at the waterline (cy: 0 = top of the ocean band). Bright center
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

/**
 * Sun below the horizon. Deep indigo, with the clouds dropped to low alpha so
 * they read as silhouettes instead of lit masses, and a cool moonlit waterline
 * in place of the warm one.
 */
export const NIGHT: SkyPalette = {
  skyTop: [16, 20, 48, 1], // #101430
  skyBottom: [30, 28, 66, 1], // #1E1C42
  oceanBase: [22, 26, 62, 1], // #161A3E
  oceanGlow: {
    cx: 0.5,
    cy: 0.0,
    r: 0.95,
    stops: [
      { offset: 0, color: [92, 110, 180, 0.3] },
      { offset: 0.55, color: [48, 60, 124, 0.2] },
      { offset: 1, color: [22, 26, 62, 0] },
    ],
  },
  cloud1: {
    cx: 0.1,
    cy: 0.4,
    r: 0.4,
    stops: [
      { offset: 0, color: [74, 86, 146, 0.3] },
      { offset: 0.5, color: [58, 68, 124, 0.22] },
      { offset: 0.85, color: [40, 48, 96, 0.1] },
      { offset: 1, color: [16, 20, 48, 0] },
    ],
  },
  cloud2: {
    cx: 1.0,
    cy: 1.0,
    r: 0.7,
    stops: [
      { offset: 0, color: [46, 54, 110, 0.4] },
      { offset: 1, color: [46, 54, 110, 0] },
    ],
  },
}

/**
 * The blue hour, bridging night and sunset. A straight blend between those two
 * crosses through a desaturated grey, since all colour here is mixed in gamma
 * space. This preset holds the midpoint at a saturated periwinkle instead, with
 * a warm horizon under a deep sky.
 */
export const TWILIGHT: SkyPalette = {
  skyTop: [92, 86, 168, 1], // #5C56A8
  skyBottom: [192, 122, 168, 1], // #C07AA8
  oceanBase: [106, 90, 176, 1], // #6A5AB0
  oceanGlow: {
    cx: 0.5,
    cy: 0.0,
    r: 0.95,
    stops: [
      { offset: 0, color: [246, 190, 230, 0.42] },
      { offset: 0.55, color: [150, 120, 200, 0.28] },
      { offset: 1, color: [106, 90, 176, 0] },
    ],
  },
  cloud1: {
    cx: 0.1,
    cy: 0.4,
    r: 0.4,
    stops: [
      { offset: 0, color: [206, 178, 206, 0.35] },
      { offset: 0.5, color: [170, 150, 200, 0.27] },
      { offset: 0.85, color: [120, 104, 180, 0.1] },
      { offset: 1, color: [92, 86, 168, 0] },
    ],
  },
  cloud2: {
    cx: 1.0,
    cy: 1.0,
    r: 0.7,
    stops: [
      { offset: 0, color: [128, 110, 196, 0.45] },
      { offset: 1, color: [128, 110, 196, 0] },
    ],
  },
}

/**
 * High sun. Cool blue with near-white cloud highlights. Only reached when the
 * sun climbs past the last stop in `DAY_CYCLE`, which in Berlin means the
 * summer half of the year.
 */
export const NOON: SkyPalette = {
  skyTop: [126, 186, 240, 1], // #7EBAF0
  skyBottom: [186, 220, 246, 1], // #BADCF6
  oceanBase: [64, 130, 214, 1], // #4082D6
  oceanGlow: {
    cx: 0.5,
    cy: 0.0,
    r: 0.95,
    stops: [
      { offset: 0, color: [200, 230, 250, 0.52] },
      { offset: 0.55, color: [130, 180, 232, 0.35] },
      { offset: 1, color: [64, 130, 214, 0] },
    ],
  },
  cloud1: {
    cx: 0.1,
    cy: 0.4,
    r: 0.4,
    stops: [
      { offset: 0, color: [255, 255, 255, 0.45] },
      { offset: 0.5, color: [238, 247, 253, 0.33] },
      { offset: 0.85, color: [210, 231, 247, 0.12] },
      { offset: 1, color: [126, 186, 240, 0] },
    ],
  },
  cloud2: {
    cx: 1.0,
    cy: 1.0,
    r: 0.7,
    stops: [
      { offset: 0, color: [168, 206, 240, 0.5] },
      { offset: 1, color: [168, 206, 240, 0] },
    ],
  },
}

/**
 * WCAG relative luminance, from 0 for black to 1 for white. Alpha is ignored,
 * since every sky color it is asked about is opaque.
 */
export function relativeLuminance(c: Rgba): number {
  const channel = (v: number): number => {
    const s = v / 255
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return (
    0.2126 * channel(c[0]) + 0.7152 * channel(c[1]) + 0.0722 * channel(c[2])
  )
}

/** WCAG contrast ratio between two luminances, from 1 to 21. */
function contrastRatio(a: number, b: number): number {
  return a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05)
}

/**
 * Whether `dark` reads better than `light` on top of `background`.
 *
 * Compares both contrast ratios rather than thresholding the background's
 * luminance, so the answer stays right if either ink is retinted.
 */
export function prefersDarkInk(
  background: Rgba,
  dark: Rgba,
  light: Rgba,
): boolean {
  const bg = relativeLuminance(background)
  return (
    contrastRatio(bg, relativeLuminance(dark)) >=
    contrastRatio(bg, relativeLuminance(light))
  )
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

import { mixColor } from 'stargazer'
import { blendShapes, DECOR_FIELDS, type Decor, type DecorShape } from './decor'

/**
 * One field of halftone dots. The dots grow with the tone of the spots the
 * background draws, so a spot that moves changes the size of dots and never
 * switches single dots on and off.
 */
export interface FieldLook {
  /** The color of a full dot. */
  ink: string
  /** The width of a cell, in CSS pixels. */
  cell: number
  dot: 'circle-am' | 'square-am'
  /** A gain on the dot size. Below 1 keeps the dots small. */
  gain: number
  /** How strong the field is where the story puts its spots, 0 to 1. */
  strength: number
  /** The strength the field keeps when the story lights nothing, 0 to 1. */
  rest: number
  /** A round spot, or a shaft of light falling from the top right. */
  shape: 'spot' | 'beam'
  /**
   * True for light that may sit under text, such as the kitchen door in the
   * dark. Its dots stay small, so the text's contrast with the ink is not
   * required.
   */
  glow: boolean
}

/**
 * How a stretch of the story looks: the color behind the text, the type and the
 * buttons, and the two fields of dots over the color.
 */
export interface Mood {
  background: string
  /** Text, and the answers' squares. */
  text: string
  /** Buttons, and the answer just picked. */
  action: string
  /** Text on a button. */
  actionText: string
  /** Fed by the first two spots. */
  base: FieldLook
  /** Fed by the third spot, and by `rest`. */
  accent: FieldLook
  /** How much the spots shake, 0 to 1. Used for a fight. */
  ragged: number
  /** Flat shapes over the dots and under the text. Default none. */
  decor?: Decor
}

const rect = (
  field: number,
  x: number,
  y: number,
  w: number,
  h: number,
  rotate: number,
): DecorShape => ({ shape: 'rect', field, x, y, w, h, rotate })

const circle = (
  field: number,
  x: number,
  y: number,
  w: number,
  more: Partial<DecorShape> = {},
): DecorShape => ({ shape: 'circle', field, x, y, w, ...more })

/**
 * The circle the text sits on, in the middle of the screen and in field 2. On a
 * tall screen it grows, since the text fills the width.
 */
const halo = (size = 1.1, more: Partial<DecorShape> = {}): DecorShape =>
  circle(2, 0.5, 0.5, size, {
    underText: true,
    portrait: { w: size * 1.5 },
    ...more,
  })

function field(look: Partial<FieldLook> & Pick<FieldLook, 'ink'>): FieldLook {
  return {
    cell: 12,
    dot: 'circle-am',
    gain: 0.85,
    strength: 1,
    rest: 0,
    shape: 'spot',
    glow: false,
    ...look,
  }
}

/** A field for the shapes at the edges of the screen. */
const edge = (ink: string, look: Partial<FieldLook> = {}): FieldLook =>
  field({ ink, cell: 14, gain: 0.85, ...look })

/**
 * The field of the circle under the text. Its dots stay small, so the text does
 * not lose contrast on it.
 */
const haloField = (ink: string): FieldLook =>
  field({ ink, cell: 14, gain: 0.65, strength: 0.7, glow: true })

/** A field that draws nothing, for a mood with fewer fields than the most. */
const unused = field({ ink: '#000000', strength: 0 })

function decor(shapes: readonly DecorShape[], ...fields: FieldLook[]): Decor {
  return {
    fields: Array.from({ length: DECOR_FIELDS }, (_, i) => fields[i] ?? unused),
    shapes,
  }
}

/**
 * Every mood a story screen can name. The text always has at least 7 to 1
 * contrast with the background, and with the ink of a field that is not a
 * glow.
 */
export const MOODS = {
  /** The age check as it opens: white, with red and orange dots. */
  booth: {
    background: '#FFFFFF',
    text: '#161616',
    action: '#FF453F',
    actionText: '#FFFFFF',
    base: field({ ink: '#FF453F' }),
    accent: field({ ink: '#FF9456' }),
    ragged: 0,
  },
  /**
   * The driveway: the booth's palette still, so the story does not give away
   * that it is turning into a narrative, with the first shapes.
   */
  driveway: {
    background: '#FFFFFF',
    text: '#161616',
    action: '#FF453F',
    actionText: '#FFFFFF',
    base: field({ ink: '#FF453F' }),
    accent: field({ ink: '#FF9456' }),
    ragged: 0,
    decor: decor(
      [
        circle(0, 0.05, 0.22, 0.45),
        circle(1, 0.97, 0.88, 0.5),
        rect(1, 1, 0.2, 0.14, 0.32, -12),
        circle(0, 0.1, 0.95, 0.24),
      ],
      edge('#FF453F'),
      edge('#FF9456', { cell: 12 }),
    ),
  },
  /** The house in the evening, inverted: dark brown with cream type. */
  home: {
    background: '#2B1B14',
    text: '#FFF1DC',
    action: '#F4B183',
    actionText: '#2B1B14',
    base: field({ ink: '#5A3626' }),
    accent: field({ ink: '#8A4B30', rest: 0.45 }),
    ragged: 0,
    decor: decor(
      [
        circle(0, 0.04, 0.24, 0.48),
        circle(1, 0.96, 0.82, 0.58),
        rect(0, 1, 0.22, 0.16, 0.34, -14),
      ],
      edge('#7A4A33'),
      edge('#9A5C3E', { cell: 12 }),
    ),
  },
  /** A good Sunday: pale yellow, mint and sun, with round and square dots. */
  sunday: {
    background: '#FFFAE6',
    text: '#1C2B2D',
    action: '#1F7A6D',
    actionText: '#FFFFFF',
    base: field({ ink: '#8ED8BE', dot: 'square-am', cell: 14 }),
    accent: field({ ink: '#FFB347', rest: 0.5, cell: 14 }),
    ragged: 0,
    decor: decor(
      [
        circle(0, 0.03, 0.18, 0.51),
        circle(1, 1, 1, 0.42),
        circle(0, 0.95, 0.12, 0.26),
        rect(1, 0, 0.82, 0.12, 0.26, 10),
        rect(0, 1, 0.5, 0.1, 0.3, -12),
      ],
      edge('#FFD84D', { cell: 16 }),
      edge('#FF8A5B'),
    ),
  },
  /** The office: cool grey with drab pastels. */
  office: {
    background: '#E8EBEE',
    text: '#1E252B',
    action: '#4A5A68',
    actionText: '#FFFFFF',
    base: field({ ink: '#B6C2CC', cell: 10 }),
    accent: field({ ink: '#C5BDD3', rest: 0.35, cell: 10 }),
    ragged: 0,
    decor: decor(
      [
        rect(0, 0, 0.15, 0.14, 0.34, 8),
        rect(1, 1, 0.88, 0.14, 0.32, -10),
        circle(0, 0.96, 0.2, 0.29),
      ],
      edge('#B6C2CC'),
      edge('#C5BDD3', { cell: 12 }),
    ),
  },
  /** The dark office, cold: steel blue-grey with icy type. */
  cold: {
    background: '#131B23',
    text: '#E6EEF5',
    action: '#8FC3E8',
    actionText: '#131B23',
    base: field({ ink: '#25323E' }),
    accent: field({ ink: '#33485B', rest: 0.3 }),
    ragged: 0,
    decor: decor(
      [
        circle(0, 0.05, 0.2, 0.5),
        circle(1, 0.95, 0.85, 0.55),
        rect(0, 1, 0.2, 0.12, 0.3, -10),
      ],
      edge('#2D4052'),
      edge('#3A566E', { cell: 12 }),
    ),
  },
  /** The house when nobody talks: dull warm grey. */
  drab: {
    background: '#E7E3DC',
    text: '#25221E',
    action: '#5C564E',
    actionText: '#FFFFFF',
    base: field({ ink: '#BDB7AC', cell: 10 }),
    accent: field({ ink: '#C4B5B0', rest: 0.3, cell: 10 }),
    ragged: 0,
  },
  /** The kitchen at midnight, when nobody talks: drab, but dark. */
  drabDark: {
    background: '#1C1A17',
    text: '#ECE7DF',
    action: '#C9B393',
    actionText: '#1C1A17',
    base: field({ ink: '#2F2C27', cell: 10 }),
    accent: field({ ink: '#3C3731', rest: 0.3, cell: 10 }),
    ragged: 0,
  },
  /** A party: lilac with yellow green and pink dots. */
  party: {
    background: '#B79CF0',
    text: '#140A26',
    action: '#8A0F55',
    actionText: '#FFFFFF',
    base: field({ ink: '#D8FF4A', cell: 14, gain: 0.9 }),
    accent: field({ ink: '#FF7AC6', dot: 'square-am', rest: 0.8, cell: 10 }),
    ragged: 0.15,
    decor: decor(
      [
        circle(0, 0.1, 0.18, 0.48),
        circle(1, 0.9, 0.82, 0.58),
        circle(0, 0.93, 0.15, 0.26),
        circle(1, 0.06, 0.86, 0.26),
      ],
      edge('#FF7AC6'),
      edge('#D8FF4A', { cell: 12 }),
    ),
  },
  /** The past: a warm golden afternoon, lively where the present is drab. */
  memory: {
    background: '#FFE7B0',
    text: '#35190C',
    action: '#B8400E',
    actionText: '#FFFFFF',
    base: field({ ink: '#FF9B54' }),
    accent: field({ ink: '#F2658F', rest: 0.4 }),
    ragged: 0,
    decor: decor(
      [
        circle(0, 0.08, 0.2, 0.55),
        circle(1, 0.92, 0.84, 0.6),
        circle(2, 0.94, 0.14, 0.3),
        circle(2, 0.05, 0.9, 0.28),
      ],
      edge('#FFB02E'),
      edge('#FF6F91', { cell: 12 }),
      edge('#2FB5A8', { cell: 12 }),
    ),
  },
  /** An argument: dark red, hot dots, and spots that shake. */
  fight: {
    background: '#1F0B0B',
    text: '#FFF4EE',
    action: '#FFB59A',
    actionText: '#2A0D0D',
    base: field({ ink: '#D63D2E', strength: 1 }),
    accent: field({ ink: '#B8461F', rest: 0.6, cell: 9 }),
    ragged: 1,
    decor: decor(
      [halo(1.6)],
      edge('#B8461F'),
      edge('#D63D2E'),
      haloField('#4A1512'),
    ),
  },
  /** The booth again, gone cold: white and blue. */
  bill: {
    background: '#F3F6FA',
    text: '#0F1923',
    action: '#3D6FB6',
    actionText: '#FFFFFF',
    base: field({ ink: '#8FB0DB' }),
    accent: field({ ink: '#B7C4D6', rest: 0.3 }),
    ragged: 0,
    decor: decor(
      [
        rect(0, 0.02, 0.2, 0.13, 0.3, 12),
        rect(1, 0.99, 0.84, 0.13, 0.3, -9),
        circle(0, 0.95, 0.15, 0.32),
      ],
      edge('#8FB0DB'),
      edge('#B7C4D6', { cell: 12 }),
    ),
  },
  /** Election night in the hotel ballroom: ketchup red and bronze. */
  ballroom: {
    background: '#7E1D1D',
    text: '#FFF6F0',
    action: '#FFC38A',
    actionText: '#3A0F0F',
    base: field({ ink: '#B0322A' }),
    accent: field({ ink: '#B87A2E', dot: 'square-am', rest: 0.5, cell: 14 }),
    ragged: 0,
    decor: decor(
      [
        circle(0, 0.08, 0.12, 0.38),
        circle(0, 0.93, 0.88, 0.48),
        circle(1, 0.92, 0.14, 0.22),
      ],
      edge('#B0322A'),
      edge('#B87A2E', { dot: 'square-am' }),
    ),
  },
  /** The car after dark. */
  car: {
    background: '#0F1623',
    text: '#EEF2F7',
    action: '#7FB0FF',
    actionText: '#0F1623',
    base: field({ ink: '#26364F' }),
    accent: field({ ink: '#3A4B68', rest: 0.2 }),
    ragged: 0,
  },
  /** The dark house, with the light of the kitchen door along the right edge. */
  night: {
    background: '#0A0A0E',
    text: '#F4EFE8',
    action: '#FFD9A0',
    actionText: '#0A0A0E',
    base: field({ ink: '#24242E' }),
    accent: field({
      ink: '#FFD9A0',
      rest: 0.7,
      cell: 9,
      gain: 0.6,
      shape: 'beam',
      glow: true,
    }),
    ragged: 0,
  },
  /** The first touch: a soft color comes into the dark. */
  warm: {
    background: '#120D0C',
    text: '#F7EEE6',
    action: '#F2B18F',
    actionText: '#120D0C',
    base: field({ ink: '#3F2A23', strength: 1 }),
    accent: field({
      ink: '#F2B18F',
      rest: 0.7,
      cell: 9,
      gain: 0.55,
      shape: 'beam',
      glow: true,
    }),
    ragged: 0,
    decor: decor([], edge('#3F2A23'), edge('#5C392C'), haloField('#6E3A28')),
  },
  /** The last screens: the color has spread a little further. */
  warmer: {
    background: '#1A1210',
    text: '#FAF1E8',
    action: '#F7BE9A',
    actionText: '#1A1210',
    base: field({ ink: '#5C392C', strength: 1 }),
    accent: field({
      ink: '#F7BE9A',
      rest: 0.9,
      cell: 9,
      gain: 0.6,
      shape: 'beam',
      glow: true,
    }),
    ragged: 0,
  },
} as const satisfies Record<string, Mood>

export type MoodName = keyof typeof MOODS

/** The mood called `name`, or the booth's when the name is missing or unknown. */
export function moodNamed(name: string | undefined): Mood {
  return name !== undefined && name in MOODS
    ? MOODS[name as MoodName]
    : MOODS.booth
}

/** Relative luminance of a `#rrggbb` or `rgb(r, g, b)` color, 0 to 1. */
function luminance(color: string): number {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(color)
  const channels = hex
    ? hex.slice(1).map((part) => parseInt(part, 16))
    : (color.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
  const [r, g, b] = channels.map((value) => {
    const v = value / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/** The contrast ratio of two colors, 1 to 21. */
export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (light! + 0.05) / (dark! + 0.05)
}

const mix = (a: string, b: string, k: number): string =>
  k <= 0 ? a : k >= 1 ? b : mixColor(a, b, k)
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k

function blendField(a: FieldLook, b: FieldLook, k: number): FieldLook {
  const to = k >= 0.5 ? b : a
  return {
    ink: mix(a.ink, b.ink, k),
    cell: lerp(a.cell, b.cell, k),
    dot: to.dot,
    gain: lerp(a.gain, b.gain, k),
    strength: lerp(a.strength, b.strength, k),
    rest: lerp(a.rest, b.rest, k),
    shape: to.shape,
    glow: to.glow,
  }
}

const NO_DECOR: Decor = decor([])

/** The shapes and fields `k` of the way from `a` to `b`. */
function blendDecor(a: Decor, b: Decor, k: number): Decor {
  return {
    fields: a.fields.map((from, i) => blendField(from, b.fields[i]!, k)),
    shapes: blendShapes(a.shapes, b.shapes, k),
  }
}

/**
 * The mood `k` of the way from `a` to `b`, 0 to 1. Colors and numbers blend. A
 * dot shape or a spot shape cannot, so it switches halfway.
 */
export function blendMood(a: Mood, b: Mood, k: number): Mood {
  return {
    background: mix(a.background, b.background, k),
    text: mix(a.text, b.text, k),
    action: mix(a.action, b.action, k),
    actionText: mix(a.actionText, b.actionText, k),
    base: blendField(a.base, b.base, k),
    accent: blendField(a.accent, b.accent, k),
    ragged: lerp(a.ragged, b.ragged, k),
    decor: blendDecor(a.decor ?? NO_DECOR, b.decor ?? NO_DECOR, k),
  }
}

/** The contrast the text must keep, to count as readable on a blend. */
const READABLE = 3

/**
 * Whether the text of a blend from `a` to `b` is unreadable somewhere along it,
 * as when a light mood becomes a dark one and the text and the background pass
 * through the same grey. A screen's words should wait out such a blend.
 */
export function blendsThroughGrey(a: Mood, b: Mood): boolean {
  for (let k = 0.05; k < 1; k += 0.05) {
    const mood = blendMood(a, b, k)
    if (contrastRatio(mood.text, mood.background) < READABLE) return true
  }
  return false
}

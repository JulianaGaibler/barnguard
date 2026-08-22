// Portrait art for the 78 candidates, drawn on a 16x16 grid.
//
// Sixteen pixels is not enough room to draw a highly detailed person, so nothing
// here draws a whole person. A portrait is composed from four small libraries —
// a garment, a hair style, a set of extras, over one fixed head.
//
// Layers are sparse: a row the layer does not paint is simply absent.
// Every present row must be exactly 16 glyphs wide, which `portraits.test.ts` pins.
//
// The glyphs, and what each resolves to at paint time:
//
//   .  transparent, leaves whatever is underneath
//   s  skin          S  skin in shadow / blush
//   h  hair          H  hair in shadow
//   c  garment       d  garment in shadow
//   C  garment trim (second dept colour, or darker first)
//   w  cloth white   k  ink, for eyes
//   a  accent        A  accent in shadow
//
// Shadows (H, d, A) are computed automatically by mixing the base colour toward
// black, so they never clash and guarantee consistent top-down lighting.

import { type Card, DECK, type Group } from '../game/rules/deck'
import { GROUP_COLORS } from '../game/tuning'

export const PORTRAIT_SIZE = 16

/** A layer, as a map from row index to a 16-glyph row. */
type Layer = Record<number, string>

/** Light to deep, as [base, shadow]. A card picks one by index. */
const SKINS: readonly (readonly [string, string])[] = [
  ['#f7d7bf', '#dcb094'],
  ['#eec49c', '#d09f74'],
  ['#d1b191', '#a58768'],
  ['#c68642', '#9d6631'],
  ['#a9663f', '#82492b'],
  ['#8d5524', '#6b3f1a'],
  ['#6d523e', '#503a2c'],
  ['#4b2d1b', '#331e11'],
]

const HAIR_COLORS = {
  black: '#191717',
  softBlack: '#2c2422',
  darkBrown: '#3d2718',
  brown: '#6b4423',
  auburn: '#8c3b1e',
  ginger: '#b5551f',
  blond: '#d9b45c',
  platinum: '#e9e1c9',
  gray: '#9aa0a6',
  white: '#e8e6e0',
  teal: '#2f7d7a',
  pink: '#c95f8e',
  blue: '#3f5fa8',
  purple: '#6b4a9e',
} as const

const ACCENTS = {
  ink: '#2b2620',
  steel: '#8b8f96',
  gold: '#d9a520',
  white: '#f2efe6',
  red: '#c2402f',
  navy: '#2b3a63',
} as const

const INK = ACCENTS.ink
const CLOTH_WHITE = '#f2efe6'

/** The head, rounded out for a cute, chibi-like silhouette. */
const HEAD: Layer = {
  2: '.....ssssss.....',
  3: '....ssssssss....',
  4: '...ssssssssss...',
  5: '..ssssssssssss..',
  6: '..ssssssssssss..',
  7: '...ssssssssss...',
  8: '....ssssssss....',
  9: '.....ssssss.....',
  10: '......SSSS......',
}
const HEAD_BEHIND: Layer = {
  10: '......SSSS......',
  11: '......ssss......',
  12: '......ssss......',
}

/** Minimalist cute eyes and a soft blush (S). Painted over the head. */
const FACE: Layer = {
  5: '.....k....k.....',
  6: '....S......S....',
}

const HAIR = {
  bald: {},
  buzz: {
    2: '.....hhhhhh.....',
    3: '....h......h....',
  },
  short: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..hhhhhhhhhhhh..',
    5: '..hh........hh..',
    6: '..H..........H..',
  },
  flattop: {
    0: '.....hhhhhh.....',
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..hh........hh..',
  },
  sidepart: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..hhhhhhhh..hh..',
    5: '..hh........hh..',
    6: '..H..........H..',
  },
  receding: {
    2: '....hh....hh....',
    3: '....hh....hh....',
    4: '...hh......hh...',
    5: '..hh........hh..',
    6: '..H..........H..',
  },
  pixie: {
    1: '.....hhhhhh.....',
    2: '...hhhhhhhhhh...',
    3: '..hhhhhhhhhhhh..',
    4: '..hh........hh..',
    5: '..H..........H..',
  },
  curly: {
    0: '......hhhh......',
    1: '....hhhhhhhh....',
    2: '...hhhhhhhhhh...',
    3: '..hhhhhhhhhhhh..',
    4: '..HH........HH..',
  },
  afro: {
    0: '.....hhhhhh.....',
    1: '...hhhhhhhhhh...',
    2: '..hhhhhhhhhhhh..',
    3: '..hhhhhhhhhhhh..',
    4: '.Hhh........hhH.',
    5: '.Hh..........hH.',
    6: '.H............H.',
  },
  wavy: {
    1: '....hhhhhhhh....',
    2: '...hhhhhhhhhh...',
    3: '..hhhhhhhhhhhh..',
    4: '..Hhh......hhH..',
    5: '..Hh........hH..',
  },
  bob: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..Hhh......hhH..',
    5: '..Hh........hH..',
    6: '..Hh........hH..',
    7: '..Hh........hH..',
    8: '..Hhh......hhH..',
  },
  long: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..Hhh......hhH..',
    5: '..Hh........hH..',
    6: '..Hh........hH..',
    7: '..Hh........hH..',
    8: '..Hh........hH..',
    9: '..Hh........hH..',
    10: '..H..........H..',
  },
  ponytail: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '....hh....hhh...',
    4: '............HH..',
    5: '.............H..',
    6: '.............H..',
    7: '.............H..',
    8: '............Hh..',
    9: '............h...',
  },
  buns: {
    0: '...hh......hh...',
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '....hh....hh....',
  },
  braids: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..H.H......H.H..',
    5: '..H.H......H.H..',
    6: '..H.H......H.H..',
  },
  locs: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..H.h......h.H..',
    5: '..H.h......h.H..',
    6: '..H.h......h.H..',
    7: '..H.h......h.H..',
    8: '..H.h......h.H..',
  },
  turban: {
    0: '....hhhhhhhh....',
    1: '...hhhhhhhhhh...',
    2: '..hhhhhhhhhhhh..',
    3: '..hhhhhhhhhhhh..',
    4: '....h......h....',
  },
  headscarf: {
    1: '.....hhhhhh.....',
    2: '....hhhhhhhh....',
    3: '...hhhhhhhhhh...',
    4: '..hhhh....hhhh..',
    5: '..hh........hh..',
    6: '..hh........hh..',
    7: '..Hh........hH..',
    8: '..Hhh......hhH..',
    9: '..HhhhhhhhhhhH..',
    10: '...hhhhhhhhhh...',
    11: '....hhhhhhhh....',
  },
} as const satisfies Record<string, Layer>

// Garments paint before the head, providing nice overlap and depth
const GARMENTS = {
  tee: {
    11: '....cc....cc....',
    12: '...cccc..cccc...',
    13: '..cccccccccccc..',
    14: '..cccccccccccc..',
    15: '..ddccccccccdd..',
  },
  shirt: {
    11: '...cC......Cc...',
    12: '..ccCccccccCcc..',
    13: '..cccccccccccc..',
    14: '..cccccccccccc..',
    15: '..ddccccccccdd..',
  },
  polo: {
    11: '...cC......Cc...',
    12: '..ccCwwwwwwCcc..',
    13: '..cccccccccccc..',
    14: '..cccccccccccc..',
    15: '..ddccccccccdd..',
  },
  suit: {
    11: '...cc......cc...',
    12: '..ccccwwwwcccc..',
    13: '..cccwwwwwwccc..',
    14: '..dccwwwwwwccd..',
    15: '..ddccccccccdd..',
  },
  blazer: {
    11: '...cc......cc...',
    12: '..cccCCCCCCccc..',
    13: '..cccCCCCCCccc..',
    14: '..dccCCCCCCccd..',
    15: '..ddccCCCCccdd..',
  },
  cardigan: {
    11: '...cc......cc...',
    12: '..cccCCCCCCccc..',
    13: '..cccCccccCccc..',
    14: '..dccCccccCccd..',
    15: '..ddcCccccCcdd..',
  },
  vest: {
    11: '...cc......cc...',
    12: '..cccwwwwwwccc..',
    13: '..cccwwwwwwccc..',
    14: '..dccwwwwwwccd..',
    15: '..ddcwwwwwwcdd..',
  },
  hoodie: {
    9: '....dd....dd....',
    10: '...cdd....ddc...',
    11: '..cccd....dccc..',
    12: '..ccccd..dcccc..',
    13: '..cccccccccccc..',
    14: '..dccccccccccd..',
    15: '..ddccccccccdd..',
  },
  turtleneck: {
    10: '.....cccccc.....',
    11: '....cccccccc....',
    12: '...cccccccccc...',
    13: '..cccccccccccc..',
    14: '..cccccccccccc..',
    15: '..ddccccccccdd..',
  },
} as const satisfies Record<string, Layer>

// Painted dead last. A dynamically shaded 'A' provides depth tracking.
const EXTRAS = {
  headset: {
    1: '.....aaaaaa.....',
    2: '....aa....aa....',
    3: '...aa......aa...',
    4: '...aa......aa...',
    5: '..Aa........aA..',
    6: '..Aa........aA..',
  },
  earrings: { 7: '..A..........A..' },
  headband: {
    3: '...aaaaaaaaaa...',
    4: '..a..........a..',
  },
  cap: {
    1: '......aaaa......',
    2: '.....aaaaaa.....',
    3: '....aaaaaaaa....',
    4: '...aaaaaaaaaa...',
  },
  beanie: {
    0: '......aaaa......',
    1: '.....aaaaaa.....',
    2: '....aaaaaaaa....',
    3: '....aaaaaaaa....',
    4: '....aaaaaaaa....',
  },
  scarf: {
    10: '.....aaaaaa.....',
    11: '....aaaaaaaa....',
    12: '....AAaaaaAA....',
  },
  tie: {
    12: '.......aa.......',
    13: '.......aa.......',
    14: '.......aa.......',
    15: '.......AA.......',
  },
  bowtie: { 12: '......aaaa......' },
  beard: {
    8: '....h......h....',
    9: '....hhhhhhhh....',
    10: '.....HHHHHH.....',
  },
  goatee: {
    8: '......h..h......',
    9: '......hhhh......',
    10: '.......HH.......',
  },
  mustache: { 7: '......hhhh......' },
} as const satisfies Record<string, Layer>

const EXTRA_ACCENT = {
  headset: 'ink',
  earrings: 'gold',
  headband: 'red',
  cap: 'navy',
  beanie: 'navy',
  scarf: 'red',
  tie: 'ink',
  bowtie: 'ink',
  beard: 'ink',
  goatee: 'ink',
  mustache: 'ink',
} as const satisfies Record<keyof typeof EXTRAS, keyof typeof ACCENTS>

export type HairStyle = keyof typeof HAIR
export type Garment = keyof typeof GARMENTS
export type Extra = keyof typeof EXTRAS
export type HairColor = keyof typeof HAIR_COLORS
export type Accent = keyof typeof ACCENTS | 'group' | 'group2'

export type PortraitSpec = [
  number,
  HairStyle,
  HairColor,
  Garment,
  Extra[]?,
  Accent?,
]

export const PORTRAITS: Record<string, PortraitSpec> = {
  // Management floor
  'mgmt-head-of-business-analytics': [2, 'short', 'darkBrown', 'shirt'],
  'mgmt-insights-manager': [5, 'braids', 'black', 'blazer', ['earrings']],
  'mgmt-research-operations-manager': [0, 'bob', 'ginger', 'cardigan'],
  'mgmt-data-scientist-manager': [3, 'buzz', 'black', 'hoodie'],
  'mgmt-head-of-it-infrastructure': [6, 'long', 'black', 'polo', ['headset']],
  'mgmt-chief-marketing-officer': [1, 'wavy', 'blond', 'blazer', ['earrings']],
  'mgmt-head-of-workflow-innovation': [4, 'bob', 'darkBrown', 'shirt'],
  'mgmt-people-operations-manager': [7, 'buns', 'black', 'blazer'],
  'mgmt-vp-of-data-and-research': [3, 'receding', 'brown', 'suit', ['tie']],
  'mgmt-head-of-employee-experience': [
    5,
    'afro',
    'black',
    'cardigan',
    ['earrings'],
  ],
  'mgmt-chief-technical-officer': [
    0,
    'ponytail',
    'brown',
    'hoodie',
    ['earrings'],
  ],
  'mgmt-culture-engagement-manager': [3, 'afro', 'auburn', 'tee', ['earrings']],
  'mgmt-board-member': [1, 'receding', 'white', 'suit', ['tie']],
  'mgmt-head-of-product': [6, 'buzz', 'black', 'shirt', ['earrings']],
  'mgmt-frontend-engineering-manager': [
    2,
    'curly',
    'brown',
    'hoodie',
    ['headset'],
  ],
  'mgmt-ur-program-manager': [4, 'headscarf', 'teal', 'blazer'],
  'mgmt-workforce-planning-lead': [7, 'braids', 'black', 'suit', ['tie']],
  'mgmt-director-of-engineering': [0, 'buzz', 'gray', 'polo', ['beard']],
  'mgmt-ceo': [3, 'long', 'gray', 'suit', ['tie', 'earrings']],
  'mgmt-chief-people-officer': [5, 'bob', 'black', 'blazer', ['earrings']],
  'mgmt-chief-of-staff': [1, 'pixie', 'platinum', 'blazer', ['earrings']],
  'mgmt-general-counsel': [6, 'bob', 'black', 'suit', ['tie']],
  'mgmt-director-of-data-and-analytics': [2, 'long', 'brown', 'shirt'],
  'mgmt-principal-product-manager': [4, 'curly', 'black', 'polo'],
  'mgmt-director-of-product-management': [
    0,
    'wavy',
    'auburn',
    'blazer',
    ['earrings'],
  ],
  'mgmt-vp-security': [7, 'buns', 'black', 'polo'],
  'mgmt-mailroom-clerk': [5, 'short', 'black', 'polo', ['cap'], 'group'],
  'mgmt-product-operations-manager': [1, 'ponytail', 'brown', 'shirt'],
  'mgmt-director-of-research': [6, 'receding', 'white', 'cardigan', ['beard']],
  'mgmt-release-operations-manager': [2, 'afro', 'ginger', 'tee', ['headset']],
  'mgmt-lead-of-remote-employee-program': [
    4,
    'long',
    'pink',
    'hoodie',
    ['headset'],
  ],
  'mgmt-chief-operating-officer': [
    2,
    'short',
    'gray',
    'suit',
    ['tie', 'earrings'],
  ],
  'mgmt-vp-public-relations': [5, 'wavy', 'black', 'blazer', ['earrings']],
  'mgmt-principal-researcher': [7, 'sidepart', 'black', 'cardigan'],
  'mgmt-outside-advisor': [1, 'bald', 'gray', 'suit', ['tie', 'mustache']],
  'mgmt-head-of-product-strategy': [3, 'bob', 'darkBrown', 'blazer'],
  'mgmt-people-business-partner': [2, 'braids', 'auburn', 'shirt'],
  'mgmt-chief-financial-officer': [6, 'long', 'black', 'suit', ['tie']],
  'mgmt-director-of-recruiting': [4, 'afro', 'black', 'blazer', ['earrings']],
  // IC floor
  'ic-security-engineer': [5, 'buzz', 'black', 'hoodie', ['earrings']],
  'ic-content-designer': [1, 'pixie', 'pink', 'turtleneck', ['earrings']],
  'ic-zero-to-one-pm': [3, 'curly', 'brown', 'tee'],
  'ic-icon-designer': [7, 'buns', 'black', 'turtleneck', ['earrings']],
  'ic-ux-desktop-manager': [0, 'curly', 'auburn', 'turtleneck', ['earrings']],
  'ic-backend-engineer': [
    2,
    'long',
    'darkBrown',
    'hoodie',
    ['headset', 'beard'],
  ],
  'ic-growth-pm': [6, 'flattop', 'black', 'polo', ['earrings']],
  'ic-design-systems-designer': [
    0,
    'long',
    'brown',
    'turtleneck',
    ['earrings'],
  ],
  'ic-web-platform-engineer': [1, 'curly', 'ginger', 'tee'],
  'ic-site-reliability-engineer': [
    5,
    'ponytail',
    'black',
    'hoodie',
    ['headset', 'goatee'],
  ],
  'ic-staff-researcher': [3, 'wavy', 'gray', 'cardigan'],
  'ic-sunset-program-manager': [7, 'buns', 'black', 'shirt'],
  'ic-senior-product-designer': [
    0,
    'long',
    'blond',
    'turtleneck',
    ['earrings'],
  ],
  'ic-ux-operations-lead': [6, 'braids', 'black', 'blazer', ['earrings']],
  'ic-design-manager': [7, 'sidepart', 'black', 'shirt', ['mustache']],
  'ic-design-systems-engineer': [4, 'wavy', 'black', 'tee'],
  'ic-data-scientist': [1, 'short', 'darkBrown', 'hoodie', ['goatee']],
  'ic-ux-engineer': [5, 'afro', 'black', 'hoodie', ['headset']],
  'ic-technical-program-manager': [3, 'locs', 'black', 'shirt'],
  'ic-agency-designer': [2, 'pixie', 'platinum', 'blazer'],
  'ic-interim-innovation-director': [2, 'receding', 'gray', 'blazer', ['tie']],
  'ic-boomerang-hire': [6, 'buzz', 'black', 'tee', ['goatee']],
  'ic-design-people-partner': [4, 'wavy', 'auburn', 'cardigan', ['earrings']],
  'ic-qualitative-researcher': [2, 'headscarf', 'purple', 'cardigan'],
  'ic-mobile-engineer': [1, 'ponytail', 'blue', 'hoodie', ['headset']],
  'ic-user-experience-advocate': [3, 'curly', 'black', 'tee'],
  'ic-engineering-people-partner': [5, 'buns', 'black', 'blazer'],
  'ic-ux-lead': [0, 'bob', 'ginger', 'turtleneck', ['earrings']],
  'ic-os-integration-engineer': [
    2,
    'short',
    'brown',
    'hoodie',
    ['beanie', 'beard'],
    'group',
  ],
  'ic-market-researcher': [6, 'short', 'black', 'shirt'],
  'ic-product-manager-2': [4, 'sidepart', 'black', 'polo'],
  'ic-director-of-ux': [1, 'long', 'gray', 'blazer', ['earrings']],
  'ic-accessibility-engineer': [7, 'wavy', 'black', 'tee', ['headset']],
  'ic-accessibility-advocate': [
    3,
    'long',
    'purple',
    'turtleneck',
    ['earrings'],
  ],
  'ic-ai-designer': [5, 'buzz', 'pink', 'turtleneck', ['earrings']],
  'ic-recruiting-coordinator': [0, 'braids', 'blond', 'tee'],
  'ic-user-experience-researcher': [6, 'afro', 'black', 'cardigan'],
  'ic-illustrator': [
    2,
    'buns',
    'auburn',
    'turtleneck',
    ['earrings', 'headband'],
    'group',
  ],
  'ic-ux-mobile-manager': [4, 'braids', 'black', 'turtleneck', ['earrings']],
}

/** Mix a colour toward black (negative) or white (positive). */
const shade = (hex: string, amount: number): string => {
  const n = Number.parseInt(hex.slice(1), 16)
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(v + (amount < 0 ? v : 255 - v) * amount),
  )
  return `#${channels.map((v) => v.toString(16).padStart(2, '0')).join('')}`
}

/** Resolve one card's glyph alphabet, automatically computing robust shadows. */
const paletteFor = (
  groups: readonly Group[],
  spec: PortraitSpec,
): { palette: Record<string, string>; accentOf: (a: Accent) => string } => {
  const [skinIndex, , hairColor] = spec
  const [skin, skinShadow] = SKINS[skinIndex % SKINS.length]!
  const primary = GROUP_COLORS[groups[0]!].fill
  const second = groups[1]
  const trim =
    second && second !== groups[0]
      ? GROUP_COLORS[second].fill
      : shade(primary, -0.3)
  const accentOf = (accent: Accent): string =>
    accent === 'group' ? primary : accent === 'group2' ? trim : ACCENTS[accent]
  return {
    palette: {
      s: skin,
      S: skinShadow, // Doubles beautifully as blush/nose depth
      h: HAIR_COLORS[hairColor],
      H: shade(HAIR_COLORS[hairColor], -0.2),
      c: primary,
      d: shade(primary, -0.2),
      C: trim,
      w: CLOTH_WHITE,
      k: INK,
    },
    accentOf,
  }
}

/**
 * A spec drawn as a 16x16 grid of CSS colours, row-major, with `null` wherever
 * the art is transparent. Layers paint garment first and extras last.
 */
export function renderPortrait(
  spec: PortraitSpec,
  groups: readonly Group[],
): (string | null)[][] {
  const [, hair, , garment, extras = [], accent] = spec
  const { palette, accentOf } = paletteFor(groups, spec)

  const grid: (string | null)[][] = Array.from({ length: PORTRAIT_SIZE }, () =>
    Array.from({ length: PORTRAIT_SIZE }, () => null),
  )
  const paint = (layer: Layer, accentColor?: string): void => {
    const accentShadow = accentColor ? shade(accentColor, -0.2) : undefined

    for (const [row, glyphs] of Object.entries(layer)) {
      const r = Number(row)
      for (let c = 0; c < PORTRAIT_SIZE; c++) {
        const glyph = glyphs[c]!
        let colour: string | undefined

        if (glyph === 'a') colour = accentColor
        else if (glyph === 'A') colour = accentShadow
        else colour = palette[glyph]

        if (colour) grid[r]![c] = colour
      }
    }
  }

  paint(HEAD_BEHIND)
  paint(GARMENTS[garment])
  paint(HEAD)
  paint(HAIR[hair])
  paint(FACE)
  for (const extra of extras) {
    paint(EXTRAS[extra], accentOf(accent ?? EXTRA_ACCENT[extra]))
  }
  return grid
}

/** The portrait a card wears, dressed in that card's own departments. */
export function portraitPixels(card: Card): (string | null)[][] {
  const spec = PORTRAITS[card.id]
  if (!spec) throw new Error(`no portrait for ${card.id}`)
  return renderPortrait(spec, card.groups)
}

/** One horizontal run of same-coloured pixels in a portrait row. */
export interface PortraitRun {
  /** Row index, 0..15. */
  row: number
  /** First column of the run, 0..15. */
  x: number
  /** Run length in cells. */
  len: number
  color: string
}

const runCache = new Map<string, PortraitRun[]>()

/**
 * A card's portrait as horizontal run-length spans, memoised. `CardNode` draws
 * these as a `fillRect` each (~60 per card) over the portrait disc rather than
 * 256 single-pixel rects or a per-card texture.
 */
export function portraitRuns(card: Card): PortraitRun[] {
  const hit = runCache.get(card.id)
  if (hit) return hit
  const grid = portraitPixels(card)
  const runs: PortraitRun[] = []
  for (let r = 0; r < grid.length; r++) {
    const row = grid[r]!
    let c = 0
    while (c < row.length) {
      const color = row[c]
      if (color == null) {
        c++
        continue
      }
      let len = 1
      while (c + len < row.length && row[c + len] === color) len++
      runs.push({ row: r, x: c, len, color })
      c += len
    }
  }
  runCache.set(card.id, runs)
  return runs
}

/** Every card, in deck order, paired with its pixels. Drives the preview. */
export const allPortraits = (): { card: Card; pixels: (string | null)[][] }[] =>
  DECK.map((card) => ({ card, pixels: portraitPixels(card) }))

/** The raw layers, for the preview page and the geometry tests. */
export const LIBRARY = {
  HAIR,
  GARMENTS,
  EXTRAS,
  HEAD,
  FACE,
  SKINS,
  HAIR_COLORS,
  ACCENTS,
}

/**
 * Typefaces: the two themeable roles, and a named handle for every shipped
 * family.
 *
 * Two layers, deliberately:
 *
 * 1. **Roles** — `text` and `heading`. These are the defaults nearly all copy
 *    inherits, and they are the only things a display or game overrides. Two is
 *    enough: a role per use-case turned out to be a wide surface that no theme
 *    ever filled in.
 * 2. **Families** — one variable per shipped face (`--font-geist`,
 *    `--font-bungee`, …). Not themeable, just a name for a stack so a component
 *    that wants one specific face can say so without repeating the fallbacks.
 *    This is the escape hatch for everything the two roles do not cover:
 *    monospace figures, a wide face for a score, a display face for one game's
 *    chrome.
 *
 * The DOM reads both layers as custom properties. The engine canvas cannot — it
 * draws into a `<canvas>` that is a SIBLING of the per-game theme scope, so
 * `getComputedStyle` on it would never see a game's override. This module is
 * therefore the source of truth and `styles/scale.sass` mirrors it, with a test
 * parsing the stylesheet to keep the two in step.
 */

import type { ThemeFonts } from './types'

/** The themeable roles, in a stable order. */
export const FONT_ROLES = ['text', 'heading'] as const

export type FontRole = (typeof FONT_ROLES)[number]

/** A `ThemeFonts` with both roles filled in. What `fontFor` takes. */
export type ResolvedFonts = Required<ThemeFonts>

const SANS_TAIL =
  '-apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif'
const MONO_TAIL = 'ui-monospace, "SF Mono", Menlo, monospace'

/**
 * Every shipped family as a ready-to-use stack, keyed by a stable id.
 *
 * Each entry is mirrored in `scale.sass` as `--font-<kebab-id>`, so
 * `FAMILIES.bungee` and `var(--font-bungee)` are the same string. Use these
 * directly when a specific face is wanted rather than "whatever the theme says"
 * — a monospace readout, a wide numeral, a game's own display type.
 */
export const FAMILIES = {
  mozillaText: `"Mozilla Text", ${SANS_TAIL}`,
  mozillaHeadline: `"Mozilla Headline", ${SANS_TAIL}`,
  mozillaHeadlineExtended: `"Mozilla Headline Extended", ${SANS_TAIL}`,
  azeretMono: `"Azeret Mono", ${MONO_TAIL}`,
  geist: `"Geist", ${SANS_TAIL}`,
  hkGrotesk: `"HK Grotesk", ${SANS_TAIL}`,
  bungee: '"Bungee", "Arial Black", sans-serif',
  raleway: `"Raleway", ${SANS_TAIL}`,
  sniglet: '"Sniglet", "Comic Sans MS", cursive',
  sortsMillGoudy: '"Sorts Mill Goudy", Georgia, "Times New Roman", serif',
  bagnard: '"Bagnard", Georgia, serif',
} as const

export type FamilyId = keyof typeof FAMILIES

/**
 * The stack behind each role when nothing overrides it.
 *
 * Kept byte-identical to the `--font-*` block in `styles/scale.sass`, which is
 * what the DOM reads. `fonts.test.ts` parses that file and asserts the two
 * match, so the duplication cannot rot.
 */
export const DEFAULT_FONTS: ResolvedFonts = {
  text: FAMILIES.mozillaText,
  heading: FAMILIES.mozillaHeadline,
}

export interface VariableWeights {
  readonly variable: readonly [number, number]
}

/** Discrete shipped weights, or a continuous range for a variable font. */
export type FontWeights = readonly number[] | VariableWeights

export function isVariableWeights(w: FontWeights): w is VariableWeights {
  return !Array.isArray(w)
}

/**
 * What each family is and what it is good for. Drives the `?fonts` specimen
 * page, and `weights` drives the snapping in {@link fontFor}: asking for a
 * weight a family does not ship gets a real cut instead of a browser-
 * synthesised one, which renders differently across engines.
 */
export interface FontFamilyEntry {
  id: FamilyId
  /** The `font-family` name, exactly as declared in `styles/fonts.scss`. */
  family: string
  weights: FontWeights
  /**
   * Rough register, for the specimen page. `body` reads at UI sizes, `display`
   * only works large, `mono` is fixed-width.
   */
  kind: 'body' | 'display' | 'mono'
  /** One line on what it is for. */
  note: string
}

export const FONT_CATALOGUE: readonly FontFamilyEntry[] = [
  {
    id: 'mozillaText',
    family: 'Mozilla Text',
    weights: [400, 500, 700],
    kind: 'body',
    note: 'Brand body face. The default for `text`.',
  },
  {
    id: 'mozillaHeadline',
    family: 'Mozilla Headline',
    weights: [600],
    kind: 'display',
    note: 'Brand headline face. The default for `heading`.',
  },
  {
    id: 'mozillaHeadlineExtended',
    family: 'Mozilla Headline Extended',
    weights: [700],
    kind: 'display',
    note: 'Mozilla Headline drawn ~19% wider. Big scores, short banners.',
  },
  {
    id: 'azeretMono',
    family: 'Azeret Mono',
    weights: { variable: [100, 900] },
    kind: 'mono',
    note: 'Fixed-width. Numerics, HUD readouts, technical labels.',
  },
  {
    id: 'geist',
    family: 'Geist',
    weights: { variable: [100, 900] },
    kind: 'body',
    note: 'Neutral grotesque, variable across the full weight axis.',
  },
  {
    id: 'hkGrotesk',
    family: 'HK Grotesk',
    weights: [400, 500, 700],
    kind: 'body',
    note: 'Warmer grotesque, three static cuts.',
  },
  {
    id: 'raleway',
    family: 'Raleway',
    weights: { variable: [100, 900] },
    kind: 'body',
    note: 'Elegant grotesque, variable, the widest character coverage here.',
  },
  {
    id: 'sniglet',
    family: 'Sniglet',
    weights: [400],
    kind: 'display',
    note: 'Rounded and friendly. One weight; no Latin Extended-A.',
  },
  {
    id: 'sortsMillGoudy',
    family: 'Sorts Mill Goudy',
    weights: [400],
    kind: 'body',
    note: 'Old-style serif, the only serif shipped. One weight.',
  },
  {
    id: 'bagnard',
    family: 'Bagnard',
    weights: [400],
    kind: 'display',
    note: 'Engraved serif. Only 149 glyphs — no ß, #, %, apostrophe or brackets.',
  },
  {
    id: 'bungee',
    family: 'Bungee',
    weights: [400],
    kind: 'display',
    note: 'Heavy signage face. Holds up at medium sizes, not just poster size.',
  },
]

const byFamily = new Map(FONT_CATALOGUE.map((e) => [e.family, e]))

/**
 * The first family named in a CSS font-family stack, unquoted. Used to decide
 * which catalogue entry (if any) governs a stack's available weights.
 */
export function primaryFamily(stack: string): string {
  const first = stack.split(',')[0]?.trim() ?? ''
  return first.replace(/^['"]|['"]$/g, '')
}

/**
 * Merge override layers over the defaults, last wins. A layer's `undefined`
 * roles fall through, mirroring how `applyFonts` skips them on the DOM side.
 */
export function resolveFonts(
  ...layers: (ThemeFonts | undefined)[]
): ResolvedFonts {
  const out: ResolvedFonts = { ...DEFAULT_FONTS }
  for (const layer of layers) {
    if (!layer) continue
    for (const role of FONT_ROLES) {
      const value = layer[role]
      if (value != null) out[role] = value
    }
  }
  return out
}

const warned = new Set<string>()

/** Nearest shipped weight to the one asked for, or the request if unconstrained. */
function snapWeight(stack: string, weight: number): number {
  const entry = byFamily.get(primaryFamily(stack))
  if (!entry) return weight
  if (isVariableWeights(entry.weights)) {
    const [min, max] = entry.weights.variable
    return Math.min(max, Math.max(min, weight))
  }
  let best = entry.weights[0]
  for (const w of entry.weights) {
    if (Math.abs(w - weight) < Math.abs(best - weight)) best = w
  }
  return best
}

/**
 * Quantise a pixel size so it stays stable as a cache key.
 *
 * The engine keys its rasterized-label cache on the font string, and a size
 * derived from a layout fraction or a camera scale arrives as something like
 * `16.0000031px` and drifts every frame — which would miss the cache on every
 * draw and re-shape the string. The step is relative, so it is imperceptible at
 * any size. Mirrors `TextNode.fontString`.
 */
function quantizePx(px: number): number {
  const q = Math.max(1e-3, px)
  const step = 10 ** Math.floor(Math.log10(q) - 3)
  return Math.round(q / step) * step
}

/**
 * A CSS `font` shorthand for an explicit family stack, ready for
 * `GfxTextStyle.font`, `TextNode`, or a raw `ctx.font` assignment.
 *
 * Note that assigning an INVALID shorthand to `ctx.font` is silently ignored
 * and the previous font is kept, so a malformed stack shows up as text in the
 * wrong face rather than as an error.
 *
 * @example
 *   gfx.fillText(score, x, y, {
 *     font: fontWith(FAMILIES.azeretMono, 700, 32),
 *   })
 */
export function fontWith(
  stack: string,
  weight: number,
  sizePx: number,
): string {
  const snapped = snapWeight(stack, weight)
  if (import.meta.env.DEV && snapped !== weight) {
    const key = `${stack}:${weight}`
    if (!warned.has(key)) {
      warned.add(key)
      console.warn(
        `[fonts] ${primaryFamily(stack)} does not ship weight ${weight}; ` +
          `using ${snapped}. Synthesised weights render differently across ` +
          `engines.`,
      )
    }
  }
  return `${snapped} ${quantizePx(sizePx)}px ${stack}`
}

/**
 * A CSS `font` shorthand for a themeable role. Sugar over {@link fontWith}.
 *
 * @example
 *   const F = resolveFonts(MY_GAME_FONT_TOKENS)
 *   gfx.fillText(label, x, y, { font: fontFor(F, 'heading', 700, 44) })
 */
export function fontFor(
  fonts: ResolvedFonts,
  role: FontRole,
  weight: number,
  sizePx: number,
): string {
  return fontWith(fonts[role], weight, sizePx)
}

/** Test hook: forget which weight warnings have already fired. */
export function _resetFontWarningsForTests(): void {
  warned.clear()
}

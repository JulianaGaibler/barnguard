// Themes and slots. A slot is a property the animation names with an id. A theme
// is a list of rules that give slots new values, and `setSlots` applies the same
// kind of values by hand. Overriding replaces the property's animation, and the
// original is kept so a reset restores it.

import { parseProp, type ValueProp } from '../anim/props'
import type { LottieAnimation } from '../model/types'

/** A keyframe in a rule, in frames of the animation. */
export interface LottieRuleKeyframe {
  frame: number
  value: number | readonly number[]
  /** Easing handles as in a CSS cubic bezier, both in `[0, 1]`. */
  inTangent?: { x: number; y: number }
  outTangent?: { x: number; y: number }
  hold?: boolean
}

/** One stop of a gradient slot value. `color` is `[r, g, b, a?]` in `[0, 1]`. */
export interface LottieGradientStopValue {
  offset: number
  color: readonly number[]
}

/** A value for a slot. */
export type LottieSlotValue =
  | {
      type: 'Color' | 'Vector' | 'Position'
      value?: readonly number[]
      keyframes?: readonly LottieRuleKeyframe[]
    }
  | {
      type: 'Scalar'
      value?: number
      keyframes?: readonly LottieRuleKeyframe[]
    }
  | { type: 'Gradient'; value?: readonly LottieGradientStopValue[] }

/** A theme rule: a slot value for the slot named `id`. */
export type LottieThemeRule = LottieSlotValue & {
  id: string
  /** Animations the rule applies to. Absent means all of them. */
  animations?: readonly string[]
}

/** A parsed theme. */
export interface LottieTheme {
  rules: readonly LottieThemeRule[]
}

/** Parse the JSON of a theme file. Throws when it has no rule list. */
export function parseTheme(source: unknown): LottieTheme {
  const json = typeof source === 'string' ? JSON.parse(source) : source
  if (
    typeof json !== 'object' ||
    json === null ||
    !Array.isArray((json as { rules?: unknown }).rules)
  ) {
    throw new Error('parseTheme: a theme needs a rules array')
  }
  return { rules: (json as { rules: LottieThemeRule[] }).rules }
}

/** What an animation remembers so its slots can be reset. */
const originals = new WeakMap<LottieAnimation, Map<ValueProp, ValueProp>>()

function remember(anim: LottieAnimation, prop: ValueProp): void {
  let map = originals.get(anim)
  if (!map) originals.set(anim, (map = new Map()))
  if (!map.has(prop)) map.set(prop, prop.clone())
}

function tangent(t: { x: number; y: number } | undefined, fallback: number) {
  return { x: [t?.x ?? fallback], y: [t?.y ?? fallback] }
}

/** Build the property a slot value describes, with `dims` components. */
function valueToProp(value: LottieSlotValue, dims: number): ValueProp | null {
  switch (value.type) {
    case 'Color':
    case 'Vector':
    case 'Position':
    case 'Scalar': {
      const keyframes = value.keyframes
      const pad = (v: number | readonly number[]): number[] => {
        const a = typeof v === 'number' ? [v] : [...v]
        // A color value may omit alpha.
        while (a.length < dims) a.push(value.type === 'Color' ? 1 : 0)
        return a
      }
      if (keyframes && keyframes.length > 0) {
        // A Lottie keyframe holds both easing handles of the segment that
        // follows it. A rule gives the outgoing handle on a keyframe and the
        // incoming one on the next, so they are paired up here.
        const k = keyframes.map((kf, i) => ({
          t: kf.frame,
          s: pad(kf.value),
          i: tangent(keyframes[i + 1]?.inTangent, 1),
          o: tangent(kf.outTangent, 0),
          h: kf.hold ? 1 : 0,
        }))
        return parseProp({ a: 1, k }, dims)
      }
      if (value.value === undefined) return null
      return parseProp({ a: 0, k: pad(value.value) }, dims)
    }
    case 'Gradient': {
      const stops = value.value
      if (!stops || stops.length === 0) return null
      // Color stops `[offset, r, g, b]`, then alpha stops `[offset, a]`, which
      // fills the same flat array a gradient property holds.
      const flat: number[] = []
      for (const s of stops)
        flat.push(s.offset, s.color[0], s.color[1], s.color[2])
      for (const s of stops) flat.push(s.offset, s.color[3] ?? 1)
      while (flat.length < dims) flat.push(0)
      return parseProp({ a: 0, k: flat.slice(0, dims) }, dims)
    }
  }
}

/**
 * Give slot `id` a new value. Returns the number of properties changed, which
 * is 0 when the animation has no such slot.
 */
export function setSlotValue(
  anim: LottieAnimation,
  id: string,
  value: LottieSlotValue,
): number {
  const targets = anim.slotProps.get(id)
  if (!targets) return 0
  let changed = 0
  for (const prop of targets) {
    const replacement = valueToProp(value, prop.dims)
    if (!replacement) continue
    remember(anim, prop)
    prop.assign(replacement)
    changed++
  }
  return changed
}

/** Restore every slot of `anim` to the value the file gives it. */
export function resetSlots(anim: LottieAnimation): void {
  const map = originals.get(anim)
  if (!map) return
  for (const [prop, original] of map) prop.assign(original)
}

/**
 * Apply a theme to an animation. Slots go back to their file values first, so
 * switching themes never leaves an earlier theme's values behind. `animationId`
 * selects the rules that name it. Returns the number of properties changed.
 */
export function applyTheme(
  anim: LottieAnimation,
  theme: LottieTheme | null,
  animationId?: string,
): number {
  resetSlots(anim)
  if (!theme) return 0
  let changed = 0
  for (const rule of theme.rules) {
    if (
      rule.animations &&
      animationId !== undefined &&
      !rule.animations.includes(animationId)
    ) {
      continue
    }
    changed += setSlotValue(anim, rule.id, rule)
  }
  return changed
}

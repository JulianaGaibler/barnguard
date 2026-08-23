import { describe, it, expect } from 'vitest'
import { parseColor, type RGBA } from '@src/stargazer'
import { arcadeNightPalette, arcadeTheme } from './theme'
import { DAY_CYCLE, paletteAt } from './background/dayCycle'
import {
  prefersDarkInk,
  relativeLuminance,
  type Rgba,
} from './background/palette'

const light = arcadeTheme.palette
const rgba = (css: string): Rgba => {
  const c: RGBA = parseColor(css)
  return [c.r * 255, c.g * 255, c.b * 255, c.a]
}
const contrast = (a: string, b: string): number => {
  const [x, y] = [relativeLuminance(rgba(a)), relativeLuminance(rgba(b))]
  return x > y ? (x + 0.05) / (y + 0.05) : (y + 0.05) / (x + 0.05)
}
/** The two colour stops of a `linear-gradient(...)` declaration. */
const gradientStops = (css: string): string[] =>
  css.match(/#[0-9a-f]{6}/gi) ?? []

const AA = 4.5
const AA_LARGE = 3

describe.each([
  ['day', light],
  ['night', arcadeNightPalette],
])('the %s launcher palette', (_name, palette) => {
  it('carries every role the day palette defines', () => {
    // `applyPalette` never removes a property, so a role missing here would
    // keep its value from the other palette when the launcher switches.
    expect(Object.keys(palette).sort()).toEqual(Object.keys(light).sort())
  })

  it('reads body text against a card', () => {
    expect(
      contrast(palette.text!, palette.surfaceCard!),
    ).toBeGreaterThanOrEqual(AA)
  })

  it('reads the play label against both ends of its gradient', () => {
    const stops = gradientStops(palette.gradientPlay!)
    expect(stops.length).toBe(2)
    for (const stop of stops) {
      expect(contrast(palette.text!, stop)).toBeGreaterThanOrEqual(AA)
    }
  })

  it('reads the primary action label against its fill', () => {
    expect(
      contrast(palette.actionPrimaryText!, palette.actionPrimary!),
    ).toBeGreaterThanOrEqual(AA)
  })

  it('reads secondary text against a card', () => {
    expect(
      contrast(palette.textSecondary!, palette.surfaceCard!),
    ).toBeGreaterThanOrEqual(3)
  })
})

describe('the dark switch point', () => {
  // The logo sits directly on the sky rather than on a card, so the switch has
  // to land where the sky stops favouring the day palette's ink.
  const dayInk = rgba(light.text!)
  const nightInk = rgba(arcadeNightPalette.text!)

  const crossing = (() => {
    for (let deg = -18; deg <= 30; deg += 0.05) {
      if (prefersDarkInk(paletteAt(deg).skyTop, dayInk, nightInk)) return deg
    }
    return NaN
  })()

  it('sits where the sky starts favouring the day ink', () => {
    expect(crossing).not.toBeNaN()
    expect(DAY_CYCLE.darkBelowDeg).toBeCloseTo(crossing, 0)
  })

  it('keeps the logo legible on the sky at every point in the cycle', () => {
    // The logo is set at 4.5rem, which is large text, so the bar is 3 rather
    // than 4.5. It has to be: at the crossover the two inks are by definition
    // equally good, and no pair of inks can beat sqrt(21) there. This one
    // bottoms out near 4.3.
    let floor = Infinity
    for (let deg = -18; deg <= 60; deg += 0.5) {
      const sky = paletteAt(deg).skyTop
      const ink = deg < DAY_CYCLE.darkBelowDeg ? nightInk : dayInk
      const [a, b] = [relativeLuminance(sky), relativeLuminance(ink)]
      floor = Math.min(
        floor,
        a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05),
      )
    }
    expect(floor).toBeGreaterThanOrEqual(AA_LARGE)
  })
})

describe('the card against the sky it floats on', () => {
  const contrastWith = (fill: string, sky: Rgba): number => {
    const [a, b] = [relativeLuminance(rgba(fill)), relativeLuminance(sky)]
    return a > b ? (a + 0.05) / (b + 0.05) : (b + 0.05) / (a + 0.05)
  }

  it('separates from the night sky across the hours it holds still', () => {
    // The sky sweeps continuously through the whole band the card must sit in,
    // so at one instant every evening its luminance equals the card's exactly.
    // No fill avoids that: light text caps the card below the sky's brightest,
    // and nothing reads against the sky's darkest. What the fill can do is
    // clear the plateaus, where the sky actually rests for hours. A card at
    // #2a2750 scored 1.29 here and sank into the night.
    const plateau = paletteAt(-12).skyTop
    expect(
      contrastWith(arcadeNightPalette.surfaceCard!, plateau),
    ).toBeGreaterThan(1.85)
  })

  it('carries a light rim to survive the crossing', () => {
    // The one moment the fill matches the sky, this is what keeps the card a
    // card. A dark drop shadow cannot do it against a dark sky.
    expect(arcadeNightPalette.shadowCard).toMatch(
      /0 0 0 1px rgba\(242, 238, 252/,
    )
  })

  it('keeps the day card clear of the day sky', () => {
    // White sits past the top of the sky's range, so the day card never
    // crosses. Its weakest point is the noon blue.
    let worst = Infinity
    for (let deg = DAY_CYCLE.darkBelowDeg; deg <= 60; deg += 0.25) {
      worst = Math.min(
        worst,
        contrastWith(light.surfaceCard!, paletteAt(deg).skyTop),
      )
    }
    expect(worst).toBeGreaterThan(1.5)
  })
})

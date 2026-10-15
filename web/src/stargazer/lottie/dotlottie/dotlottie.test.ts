import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseDotLottie } from './dotlottie'
import { applyTheme, resetSlots, setSlotValue } from './theme'
import { readZip } from './zip'
import type { LottieAnimation } from '../model/types'

const load = (name: string): Uint8Array =>
  new Uint8Array(
    readFileSync(
      `${process.cwd()}/src/stargazer/dev/fixtures/lottie/${name}.lottie`,
    ),
  )

/** First sampled color of the first property that carries `slot`. */
function slotColor(anim: LottieAnimation, slot: string, frame = 0): number[] {
  const prop = anim.slotProps.get(slot)?.[0]
  if (!prop) throw new Error(`no slot ${slot}`)
  const out = new Float64Array(prop.dims)
  prop.sample(frame, out)
  return Array.from(out).map((v) => Math.round(v * 1000) / 1000)
}

describe('.lottie containers', () => {
  it('reads a version 2 archive: manifest, animations and themes', async () => {
    const file = await parseDotLottie(load('themed'))
    expect(file.manifest.version).toBe('2')
    expect(file.animationIds).toEqual(['Main Scene'])
    expect([...file.themeIds].sort()).toEqual(['Water', 'air', 'earth'])
    const anim = file.getAnimation()
    expect(anim.layers.length).toBeGreaterThan(0)
    expect([...anim.slotProps.keys()].sort()).toContain('body-main')
    // Each call parses its own copy.
    expect(file.getAnimation()).not.toBe(anim)
    expect(() => file.getAnimation('missing')).toThrow()
  })

  it('applies a theme, switches to another without leftovers, and resets', async () => {
    const file = await parseDotLottie(load('themed'))
    const anim = file.getAnimation()
    const original = slotColor(anim, 'body-main')
    expect(applyTheme(anim, file.getTheme('Water'))).toBeGreaterThan(0)
    expect(slotColor(anim, 'body-main').slice(0, 3)).toEqual([0, 0.777, 1])
    applyTheme(anim, file.getTheme('earth'))
    expect(slotColor(anim, 'body-main').slice(0, 3)).toEqual([1, 0.749, 0])
    resetSlots(anim)
    expect(slotColor(anim, 'body-main')).toEqual(original)
    applyTheme(anim, file.getTheme('air'))
    applyTheme(anim, null)
    expect(slotColor(anim, 'body-main')).toEqual(original)
  })

  it('animates a slot from theme keyframes', async () => {
    const file = await parseDotLottie(load('multi_themes'))
    const anim = file.getAnimation()
    applyTheme(anim, file.getTheme('animated_dark'))
    const start = slotColor(anim, 'bg_color', 0)
    const mid = slotColor(anim, 'bg_color', 44)
    const end = slotColor(anim, 'bg_color', 89)
    expect(start[0]).toBeCloseTo(0.2275, 2)
    expect(start[2]).toBeCloseTo(1, 3)
    expect(end.slice(0, 3)).toEqual([0, 0, 0])
    expect(mid[2]).toBeGreaterThan(0.3)
    expect(mid[2]).toBeLessThan(0.7)
  })

  it('applies a slot value by hand and limits a rule to its animations', async () => {
    const file = await parseDotLottie(load('multi_anim_theme'))
    expect([...file.animationIds].sort()).toEqual(['circle', 'rect'])
    const anim = file.getAnimation('rect')
    expect(
      setSlotValue(anim, 'color', { type: 'Color', value: [0, 1, 0] }),
    ).toBeGreaterThan(0)
    expect(slotColor(anim, 'color').slice(0, 3)).toEqual([0, 1, 0])
    expect(setSlotValue(anim, 'nope', { type: 'Scalar', value: 1 })).toBe(0)
    resetSlots(anim)
    const theme = {
      rules: [
        {
          id: 'color',
          type: 'Color' as const,
          value: [1, 0, 0],
          animations: ['circle'],
        },
      ],
    }
    expect(applyTheme(anim, theme, 'rect')).toBe(0)
    expect(applyTheme(anim, theme, 'circle')).toBeGreaterThan(0)
  })

  it('rejects things that are not safe or not archives', async () => {
    expect(() => readZip(new Uint8Array(40))).toThrow(/not a zip/)
    await expect(parseDotLottie(new Uint8Array(10))).rejects.toThrow()
  })
})

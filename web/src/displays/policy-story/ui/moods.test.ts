import { describe, expect, it } from 'vitest'
import {
  MOODS,
  blendMood,
  blendsThroughGrey,
  contrastRatio as contrast,
  moodNamed,
  type Mood,
} from './moods'

const moods = Object.entries(MOODS) as Array<[string, Mood]>

describe.each(moods)('the %s mood', (_name, mood) => {
  it('keeps the text clear of the background', () => {
    expect(contrast(mood.text, mood.background)).toBeGreaterThanOrEqual(7)
  })

  it('keeps the text clear of the dots, unless they are a small glow', () => {
    for (const field of [mood.base, mood.accent]) {
      if (field.glow) expect(field.gain).toBeLessThanOrEqual(0.6)
      else expect(contrast(mood.text, field.ink)).toBeGreaterThanOrEqual(3)
    }
  })

  it('keeps the text clear of the dots of the shapes it may cross', () => {
    for (const shape of mood.decor?.shapes ?? []) {
      const look = mood.decor!.fields[shape.field]!
      if (shape.underText) {
        expect(shape.shape).toBe('circle')
        expect(look.glow).toBe(true)
        expect(look.gain).toBeLessThanOrEqual(0.8)
        expect(contrast(mood.text, look.ink)).toBeGreaterThanOrEqual(4.5)
      } else if (!look.glow) {
        expect(contrast(mood.text, look.ink)).toBeGreaterThanOrEqual(3)
      }
    }
  })

  it('has a button that can be read and found', () => {
    expect(contrast(mood.actionText, mood.action)).toBeGreaterThanOrEqual(3)
    expect(contrast(mood.action, mood.background)).toBeGreaterThanOrEqual(3)
  })
})

describe('moodNamed', () => {
  it('falls back to the booth for a missing or unknown name', () => {
    expect(moodNamed(undefined)).toBe(MOODS.booth)
    expect(moodNamed('nowhere')).toBe(MOODS.booth)
    expect(moodNamed('night')).toBe(MOODS.night)
  })
})

describe('blendMood', () => {
  it('is the first mood at 0 and the second at 1', () => {
    const start = blendMood(MOODS.booth, MOODS.night, 0)
    const end = blendMood(MOODS.booth, MOODS.night, 1)
    expect(start.background).toBe(MOODS.booth.background)
    expect(end.background).toBe(MOODS.night.background)
    expect(end.accent.shape).toBe('beam')
    expect(start.accent.shape).toBe('spot')
  })

  it('blends numbers and switches shapes halfway', () => {
    const a = MOODS.booth
    const b = MOODS.fight
    expect(blendMood(a, b, 0.5).ragged).toBe(0.5)
    expect(blendMood(a, b, 0.5).base.cell).toBe(12)
    expect(blendMood(MOODS.sunday, MOODS.booth, 0.4).base.dot).toBe('square-am')
    expect(blendMood(MOODS.sunday, MOODS.booth, 0.6).base.dot).toBe('circle-am')
  })
})

describe('blendsThroughGrey', () => {
  it('is false between two light moods and between two dark ones', () => {
    expect(blendsThroughGrey(MOODS.booth, MOODS.sunday)).toBe(false)
    expect(blendsThroughGrey(MOODS.home, MOODS.night)).toBe(false)
    expect(blendsThroughGrey(MOODS.night, MOODS.warm)).toBe(false)
    expect(blendsThroughGrey(MOODS.fight, MOODS.night)).toBe(false)
  })

  it('is true from a light mood to a dark one, and back', () => {
    expect(blendsThroughGrey(MOODS.booth, MOODS.night)).toBe(true)
    expect(blendsThroughGrey(MOODS.night, MOODS.booth)).toBe(true)
    expect(blendsThroughGrey(MOODS.drab, MOODS.fight)).toBe(true)
    expect(blendsThroughGrey(MOODS.sunday, MOODS.home)).toBe(true)
  })

  it('is false for a mood and itself', () => {
    for (const [, mood] of moods) {
      expect(blendsThroughGrey(mood, mood)).toBe(false)
    }
  })

  it('is true for exactly the pairs whose text is lost on the way', () => {
    for (const [, a] of moods) {
      for (const [, b] of moods) {
        let worst = Infinity
        for (let k = 0.05; k < 1; k += 0.05) {
          const mood = blendMood(a, b, k)
          worst = Math.min(worst, contrast(mood.text, mood.background))
        }
        expect(blendsThroughGrey(a, b)).toBe(worst < 3)
      }
    }
  })
})

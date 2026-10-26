import { describe, expect, it } from 'vitest'
import { needsOutline } from './outline'

describe('needsOutline', () => {
  it('flags a card close to the screen', () => {
    expect(needsOutline([47, 18, 18])).toBe(true)
    expect(needsOutline([22, 22, 22])).toBe(true)
  })

  it('leaves a card that stands out', () => {
    expect(needsOutline([246, 163, 121])).toBe(false)
    expect(needsOutline([255, 251, 248])).toBe(false)
  })
})

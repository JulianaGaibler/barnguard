import { describe, expect, it } from 'vitest'
import { pieceAlpha, stagingFor, type StagingSpec } from './staging'

const spec = (over: Partial<StagingSpec> = {}): StagingSpec => ({
  pace: 'beats',
  hold: 0,
  hasLabel: false,
  replies: 0,
  paragraphs: 2,
  hasPrompt: false,
  ...over,
})

describe('stagingFor', () => {
  it('shows everything at once when the pace is together', () => {
    const staging = stagingFor(
      spec({
        pace: 'together',
        hasLabel: true,
        replies: 1,
        paragraphs: 3,
        hold: 1.5,
      }),
    )
    expect(staging.starts).toEqual([0, 0, 0, 0, 0])
    expect(staging.textEnd).toBe(0)
    expect(staging.hold).toBe(1.5)
  })

  it('starts each paragraph after the one before', () => {
    const staging = stagingFor(spec({ paragraphs: 3 }))
    expect(staging.starts).toEqual([0, 0.75, 1.5])
    expect(staging.textEnd).toBeCloseTo(1.5 + 0.55)
  })

  it('lets a label hold alone before the rest', () => {
    const staging = stagingFor(spec({ hasLabel: true, paragraphs: 1 }))
    expect(staging.starts).toEqual([0, 1.1])
  })

  it('puts a beat between the reply and the text', () => {
    const staging = stagingFor(spec({ replies: 1, paragraphs: 1 }))
    expect(staging.starts).toEqual([0, 0.95])
  })

  it('shows the prompt after the text', () => {
    const staging = stagingFor(spec({ paragraphs: 1, hasPrompt: true }))
    expect(staging.starts).toEqual([0, 0.75])
  })

  it('waits for the pace and the hold before the button', () => {
    expect(stagingFor(spec()).hold).toBeCloseTo(0.2)
    expect(stagingFor(spec({ hold: 2 })).hold).toBeCloseTo(2.2)
    expect(stagingFor(spec({ pace: 'slow', hold: 1 })).hold).toBeCloseTo(1.3)
  })

  it('is slower at a slow pace', () => {
    const beats = stagingFor(spec({ paragraphs: 3 }))
    const slow = stagingFor(spec({ pace: 'slow', paragraphs: 3 }))
    expect(slow.starts[2]!).toBeGreaterThan(beats.starts[2]!)
  })

  it('has nothing to wait for on a screen with no text', () => {
    const staging = stagingFor(spec({ paragraphs: 0 }))
    expect(staging.starts).toEqual([])
    expect(staging.textEnd).toBeCloseTo(0.55)
  })
})

describe('pieceAlpha', () => {
  const staging = stagingFor(spec({ paragraphs: 2 }))

  it('fades a part in over the fade time from its start', () => {
    expect(pieceAlpha(staging, 1, 0.5)).toBe(0)
    expect(pieceAlpha(staging, 1, 0.75)).toBe(0)
    expect(pieceAlpha(staging, 1, 0.75 + 0.275)).toBeCloseTo(0.5)
    expect(pieceAlpha(staging, 1, 5)).toBe(1)
  })

  it('shows every part at once for a screen with no fade', () => {
    const together = stagingFor(spec({ pace: 'together' }))
    expect(pieceAlpha(together, 0, 0)).toBe(1)
    expect(pieceAlpha(together, 1, 0)).toBe(1)
  })
})

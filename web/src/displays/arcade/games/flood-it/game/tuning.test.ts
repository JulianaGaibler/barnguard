import { describe, expect, it } from 'vitest'
import {
  ANIM,
  CELL_COLORS,
  CELL_GLYPHS,
  floodDuration,
  floodStagger,
  GEOM,
  PRESETS,
} from './tuning'
import type { PresetId } from './types'

const IDS: PresetId[] = ['small', 'medium', 'large']

describe('presets', () => {
  it('never asks for more colors than the palette has', () => {
    for (const id of IDS) {
      expect(PRESETS[id].colors).toBeLessThanOrEqual(CELL_COLORS.length)
      expect(PRESETS[id].colors).toBeGreaterThanOrEqual(2)
    }
  })

  it('climbs in size and colors, and tightens the allowance', () => {
    const cells = (id: PresetId): number => PRESETS[id].cols * PRESETS[id].rows
    expect(cells('medium')).toBeGreaterThan(cells('small'))
    expect(cells('large')).toBeGreaterThan(cells('medium'))
    expect(PRESETS.medium.colors).toBeGreaterThan(PRESETS.small.colors)
    expect(PRESETS.large.colors).toBeGreaterThan(PRESETS.medium.colors)
    expect(PRESETS.medium.slack).toBeLessThan(PRESETS.small.slack)
    expect(PRESETS.large.slack).toBeLessThan(PRESETS.medium.slack)
  })

  it('holds a band that a board can fall inside', () => {
    for (const id of IDS) {
      const p = PRESETS[id]
      expect(p.parMin).toBeLessThan(p.parMax)
      expect(p.parMin).toBeGreaterThan(0)
      expect(p.parMax).toBeLessThan(p.cols * p.rows)
    }
  })

  it('never allows fewer moves than par', () => {
    for (const id of IDS) expect(PRESETS[id].slack).toBeGreaterThanOrEqual(1)
  })
})

describe('glyphs', () => {
  it('covers every cell color', () => {
    expect(CELL_GLYPHS.length).toBe(CELL_COLORS.length)
  })

  it('assigns a distinct shape to each color', () => {
    expect(new Set(CELL_GLYPHS).size).toBe(CELL_GLYPHS.length)
  })

  it('assigns a distinct color to each index', () => {
    expect(new Set(CELL_COLORS).size).toBe(CELL_COLORS.length)
  })
})

describe('flood pacing', () => {
  it('holds a deep wave inside the duration cap', () => {
    for (const maxDepth of [1, 5, 12, 20, 34, 60]) {
      expect(floodDuration(maxDepth)).toBeLessThanOrEqual(
        ANIM.floodDurationCap + 1e-9,
      )
    }
  })

  it('lets a shallow wave ripple at the full per-depth delay', () => {
    // Depth 5 fits comfortably, so it should not be compressed.
    expect(floodStagger(5)).toBe(ANIM.staggerMax)
  })

  it('compresses a wave too deep for the full delay', () => {
    expect(floodStagger(40)).toBeLessThan(ANIM.staggerMax)
    expect(floodStagger(40)).toBeGreaterThan(0)
  })

  it('has no stagger for a single-cell move', () => {
    expect(floodStagger(0)).toBe(0)
    expect(floodDuration(0)).toBe(ANIM.floodFlip)
  })

  it('keeps a move quicker than the beat that follows it', () => {
    // The turn handoff waits out the flood and then some, so the pad has to be
    // a real pause rather than a rounding error.
    expect(ANIM.turnHandoffPad).toBeGreaterThan(0)
    expect(ANIM.resultHold).toBeGreaterThan(ANIM.floodDurationCap / 2)
  })
})

describe('geometry fractions', () => {
  it('leaves a visible cell inside its pitch', () => {
    expect(GEOM.cellGapFrac).toBeGreaterThan(0)
    expect(GEOM.cellGapFrac).toBeLessThan(0.3)
  })

  it('keeps every fraction inside its container', () => {
    for (const [name, value] of Object.entries(GEOM)) {
      expect(value, name).toBeGreaterThan(0)
      expect(value, name).toBeLessThanOrEqual(1)
    }
  })
})

import { describe, expect, it } from 'vitest'
import { glyphAlt, glyphAspect, glyphId, glyphSpan, parseGlyph } from './glyphs'
import type { Glyph, SimpleGlyph } from './glyphs'
import { ALL_GROUPS } from '../game/rules/deck'
import type { Area, Floor, Region } from '../game/rules/deck'

const FLOORS: Floor[] = ['management', 'ic']
const REGIONS: Exclude<Region, 'org'>[] = ['row', 'column', 'rowOrColumn']
const AREAS: Area[] = [
  'topRow',
  'middleRow',
  'bottomRow',
  'leftColumn',
  'middleColumn',
  'rightColumn',
  'corner',
  'edgeCenter',
]

/** The metrics that get a position marker after them. */
const MARKED: SimpleGlyph[] = [
  { g: 'group', group: 'design' },
  { g: 'floor', floor: 'ic' },
  { g: 'notEqual' },
]

const EVERY_GLYPH: Glyph[] = [
  { g: 'approval' },
  { g: 'budget' },
  { g: 'bag' },
  { g: 'aiSeat' },
  { g: 'emptySeat' },
  { g: 'filledSeat' },
  { g: 'missingGroup' },
  { g: 'equal' },
  { g: 'notEqual' },
  ...ALL_GROUPS.map((group): Glyph => ({ g: 'group', group })),
  ...FLOORS.map((floor): Glyph => ({ g: 'floor', floor })),
  // Every position marker paired with each of the shapes it can follow.
  ...REGIONS.flatMap((region): Glyph[] =>
    MARKED.map((inner): Glyph => ({ g: 'region', region, inner })),
  ),
  ...AREAS.map((area): Glyph => ({ g: 'area', area })),
]

describe('glyph ids', () => {
  it.each(EVERY_GLYPH.map((g) => [glyphId(g), g] as const))(
    '%s survives the round trip',
    (_id, glyph) => {
      expect(parseGlyph(glyphId(glyph))).toEqual(glyph)
    },
  )

  it('gives every glyph its own id', () => {
    const ids = EVERY_GLYPH.map(glyphId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  // An id reaches `parseGlyph` from a laid-out run, inside `draw`, so a bad one
  // has to come back as nothing rather than as an exception.
  it.each([
    '',
    'group',
    'group:accounting',
    'floor:basement',
    'region:org',
    'region:row',
    'region:row:region:column:group:design',
    'region:row:nonsense',
    'area:middle',
    'approval:1',
    'bag:1',
    'aiSeat:ic',
    'nonsense',
  ])('reads %s back as nothing', (id) => {
    expect(parseGlyph(id)).toBeNull()
  })
})

describe('glyph spans', () => {
  it('keeps each glyph on its own proportions', () => {
    // The approval slip is 28x40 and the budget note 42x26, so one shared
    // aspect would squash whichever it was not chosen for.
    expect(glyphAspect({ g: 'approval' })).toBeCloseTo(28 / 40)
    expect(glyphAspect({ g: 'budget' })).toBeCloseTo(42 / 26)
    expect(glyphAspect({ g: 'group', group: 'design' })).toBe(1)
    // A region is its glyph followed by a marker, so it is wider than the
    // glyph alone by the gap plus the marker, and a wide glyph makes a wide
    // pair.
    const marked = (inner: SimpleGlyph): Glyph => ({
      g: 'region',
      region: 'row',
      inner,
    })
    const badge: SimpleGlyph = { g: 'group', group: 'design' }
    expect(glyphAspect(marked(badge))).toBeGreaterThan(glyphAspect(badge))
    expect(glyphAspect(marked({ g: 'budget' }))).toBeGreaterThan(
      glyphAspect(marked(badge)),
    )
  })

  it('carries the id, the aspect and something to read back', () => {
    const span = glyphSpan({ g: 'group', group: 'research' })
    expect(span.box).toBe('group:research')
    expect(span.aspect).toBe(1)
    expect(span.heightEm).toBeGreaterThan(0)
    expect(span.alt).toBe('Research')
  })

  it('names every glyph, so no sentence reads back with a hole in it', () => {
    for (const glyph of EVERY_GLYPH) expect(glyphAlt(glyph)).toBeTruthy()
  })

  it('lets the caller say how a glyph reads where it stands', () => {
    // A glyph is named out of context and read in one. Three slips in a row
    // say their count once, and the rest say nothing rather than repeating the
    // word twice more.
    expect(glyphSpan({ g: 'approval' }).alt).toBe('approvals')
    expect(glyphSpan({ g: 'approval' }, { alt: '3 approvals' }).alt).toBe(
      '3 approvals',
    )
    expect(glyphSpan({ g: 'approval' }, { alt: '' }).alt).toBe('')
  })

  it('leaves a marked glyph the same size as an unmarked one', () => {
    // The marker used to be a ring around the glyph, which forced the pair to
    // more than twice the height and shrank the badge inside it. Setting the
    // marker beside the glyph instead is what buys the badge its full size
    // back, so the two heights must now agree exactly.
    const badge = glyphSpan({ g: 'group', group: 'people' })
    const marked = glyphSpan({
      g: 'region',
      region: 'row',
      inner: { g: 'group', group: 'people' },
    })
    expect(marked.heightEm).toBe(badge.heightEm)
  })

  it('gives all three markers the same reach', () => {
    // Sized on the longest side, so the wide marker and the tall one read as
    // the same size rather than one being enormous and the other a sliver.
    const badge: SimpleGlyph = { g: 'group', group: 'people' }
    const width = (region: Exclude<Region, 'org'>): number =>
      glyphAspect({ g: 'region', region, inner: badge }) - glyphAspect(badge)

    // The horizontal marker is as wide as the both-ways one, and the vertical
    // one is narrower because its long axis is the one standing up.
    expect(width('row')).toBeCloseTo(width('rowOrColumn'))
    expect(width('column')).toBeLessThan(width('row'))
  })

  it('reads a ring back as the thing it holds and where', () => {
    expect(
      glyphSpan({
        g: 'region',
        region: 'column',
        inner: { g: 'group', group: 'research' },
      }).alt,
    ).toBe('Research in this column')
  })
})

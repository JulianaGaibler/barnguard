import { describe, expect, it } from 'vitest'
import { moodNamed, MOODS } from '../ui/moods'
import { runAt } from './devJump'
import { Run, visibleText } from './run'
import { SECTIONS } from './sections'
import { story } from './story'
import { searchStates, validateStory } from './validate'

describe('the story', () => {
  it('validates with no errors or warnings', () => {
    expect(validateStory(story)).toEqual({ errors: [], warnings: [] })
  })

  it('reaches every screen, with every route resolving', () => {
    const search = searchStates(story)
    expect(search.truncated).toBe(false)
    expect([...search.reached].sort()).toEqual(Object.keys(story.nodes).sort())
    console.info(`the story has ${search.states} screen and flag states`)
  })

  it('only names moods that exist', () => {
    for (const [id, node] of Object.entries(story.nodes)) {
      if (node.mood === undefined) continue
      expect(Object.keys(MOODS), `"${id}" names "${node.mood}"`).toContain(
        node.mood,
      )
    }
  })

  it('starts as the booth and drops the progress row when the narrative begins', () => {
    const run = new Run(story)
    expect(run.mood).toBe('booth')
    const dropping = Object.entries(story.nodes).filter(
      ([, node]) => node.dropsTrail,
    )
    expect(dropping.map(([id]) => id)).toEqual(['1.05'])
    const { found } = searchStates(story, (node) => node === '6.15')
    expect(found).not.toBeNull()
    const end = new Run(story, found!)
    expect(end.trailDropped).toBe(true)
    expect(end.progress()).toEqual([])
    expect(end.history.some((step) => step.node === '1.05')).toBe(true)
  })

  it('ends once, after a slow fade to black that cuts to the last screen', () => {
    const endings = Object.entries(story.nodes).filter(
      ([, node]) => node.kind === 'ending',
    )
    expect(endings.map(([id]) => id)).toEqual(['7.01'])
    expect(endings[0]![1]).toMatchObject({ cut: true })
    expect(story.nodes['6.15']).toMatchObject({ fadeOut: true, next: '7.01' })
  })

  it('ends in the warm light, and then states the law in the booth look', () => {
    const warm = searchStates(story, (node) => node === '6.15')
    expect(moodNamed(new Run(story, warm.found!).mood)).toBe(MOODS.warmer)
    const last = searchStates(story, (node) => node === '7.01')
    const end = new Run(story, last.found!)
    expect(moodNamed(end.mood)).toBe(MOODS.booth)
    expect(end.narrated).toBe(false)
    expect(end.trailDropped).toBe(true)
  })

  it('names the bill the visitor passed on the last screen', () => {
    for (const [flag, word] of [
      ['bill=age-proof-app', 'Age Proof Act'],
      ['bill=design-rules', 'Safer Design Act'],
    ] as const) {
      const { found } = searchStates(
        story,
        (node, flags) => node === '7.01' && flags.has(flag),
      )
      const end = new Run(story, found!)
      expect(visibleText(end.current.body, end.flags).join(' ')).toContain(word)
    }
  })

  it('leaves the text of every screen room to fit', () => {
    // The longest text a screen can show for any flags, counting the reply.
    const longest: Array<[number, string]> = []
    const flagSets = new Set<string>()
    searchStates(story, (node, flags) => {
      flagSets.add(`${node}|${[...flags].sort().join(',')}`)
      return false
    })
    const lengths = new Map<string, number>()
    searchStates(story, (node, flags) => {
      const at = story.nodes[node as keyof typeof story.nodes]
      const text = visibleText(at.body, flags).join('').length
      lengths.set(node, Math.max(lengths.get(node) ?? 0, text))
      return false
    })
    for (const [id, length] of lengths) longest.push([length, id])
    longest.sort((a, b) => b[0] - a[0])
    console.info('longest screens', longest.slice(0, 8))
    expect(longest[0]![0]).toBeLessThan(1000)
  })
})

describe('the attendant sections', () => {
  it('each name a screen a run can reach', () => {
    for (const section of SECTIONS) {
      expect(runAt(story, section.node, section.flags), section.title).not.toBe(
        null,
      )
    }
  })
})

import { describe, expect, it } from 'vitest'
import { story } from './story'
import { Run } from './run'
import { enumeratePaths, validateStory } from './validate'
import type { NodeId } from './types'

describe('the story', () => {
  it('validates with no errors or warnings', () => {
    expect(validateStory(story)).toEqual({ errors: [], warnings: [] })
  })

  it('reaches every screen on some path, and ends every path', () => {
    const paths = enumeratePaths(story)
    const reached = new Set<NodeId>()
    for (const path of paths) {
      for (const step of path) reached.add(step.node)
      expect(new Run(story, path).atEnd).toBe(true)
    }
    expect([...reached].sort()).toEqual(Object.keys(story.nodes).sort())
    console.info(`the story has ${paths.length} paths`)
  })
})

/**
 * Checks a story for the mistakes a writer can make that the type checker can't
 * see: cycles, screens nothing leads to, routes that may match nothing, and
 * flags that are read but never set.
 */
import { flagsOf, resolveNext, type Step } from './run'
import type {
  Condition,
  Flag,
  Next,
  NodeId,
  Route,
  Story,
  StoryNode,
} from './types'

export interface StoryReport {
  /** Problems that break a run. */
  errors: string[]
  /** Problems that only waste something, such as a flag nothing reads. */
  warnings: string[]
}

/** Most options a choice can have, one per letter the layout fits. */
export const MAX_OPTIONS = 4
export const MIN_OPTIONS = 2

/** Every `next` on `node`, with a label for messages. */
function nextsOf(id: NodeId, node: StoryNode): { where: string; next: Next }[] {
  switch (node.kind) {
    case 'scene':
    case 'moment':
      return [{ where: `"${id}"`, next: node.next }]
    case 'choice':
      return node.options.map((option) => ({
        where: `"${id}" option "${option.id}"`,
        next: option.next,
      }))
    case 'ending':
      return []
  }
}

function routesOf(next: Next): readonly Route[] {
  return typeof next === 'string' ? [{ to: next }] : next
}

/** Every node `node` can lead to, whatever the flags. */
export function targetsOf(id: NodeId, node: StoryNode): NodeId[] {
  return nextsOf(id, node).flatMap(({ next }) =>
    routesOf(next).map((r) => r.to),
  )
}

function flagsRead(condition: Condition, into: Set<Flag>): void {
  if ('flag' in condition) into.add(condition.flag)
  else if ('not' in condition) flagsRead(condition.not, into)
  else
    for (const c of 'all' in condition ? condition.all : condition.any) {
      flagsRead(c, into)
    }
}

export function validateStory(story: Story): StoryReport {
  const errors: string[] = []
  const warnings: string[] = []
  const ids = Object.keys(story.nodes)
  const nodes = story.nodes as Readonly<Record<NodeId, StoryNode>>

  if (!nodes[story.start]) {
    errors.push(`the start "${story.start}" is not a node`)
    return { errors, warnings }
  }

  const set = new Set<Flag>()
  const read = new Set<Flag>()

  for (const id of ids) {
    const node = nodes[id]!
    for (const paragraph of node.body) {
      if (typeof paragraph !== 'string') flagsRead(paragraph.when, read)
    }
    if (node.kind === 'choice') {
      const count = node.options.length
      if (count < MIN_OPTIONS || count > MAX_OPTIONS) {
        errors.push(
          `"${id}" has ${count} options, it needs ${MIN_OPTIONS} to ${MAX_OPTIONS}`,
        )
      }
      const seen = new Set<string>()
      for (const option of node.options) {
        if (seen.has(option.id)) {
          errors.push(`"${id}" has two options with the id "${option.id}"`)
        }
        seen.add(option.id)
        for (const flag of option.sets ?? []) set.add(flag)
      }
    }
    for (const { where, next } of nextsOf(id, node)) {
      const routes = routesOf(next)
      if (routes.length === 0) {
        errors.push(`${where} leads nowhere`)
        continue
      }
      if (routes[routes.length - 1]!.when) {
        errors.push(
          `${where} can match no route, its last route needs no "when"`,
        )
      }
      routes.forEach((route, i) => {
        if (route.when) flagsRead(route.when, read)
        if (!route.when && i < routes.length - 1) {
          errors.push(`${where} has routes after one that always matches`)
        }
        if (!nodes[route.to]) {
          errors.push(`${where} leads to "${route.to}", which is not a node`)
        }
      })
    }
  }

  for (const flag of read) {
    if (!set.has(flag)) errors.push(`the flag "${flag}" is read but never set`)
  }
  for (const flag of set) {
    if (!read.has(flag))
      warnings.push(`the flag "${flag}" is set but never read`)
  }

  const cycle = findCycle(story)
  if (cycle) errors.push(`the story loops: ${cycle.join(' → ')}`)

  const reached = new Set<NodeId>([story.start])
  const queue = [story.start]
  while (queue.length) {
    const id = queue.pop()!
    const node = nodes[id]
    if (!node) continue
    for (const to of targetsOf(id, node)) {
      if (!reached.has(to) && nodes[to]) {
        reached.add(to)
        queue.push(to)
      }
    }
  }
  for (const id of ids) {
    if (!reached.has(id)) errors.push(`nothing leads to "${id}"`)
  }

  return { errors, warnings }
}

/** A path that comes back to where it started, or null when there is none. */
export function findCycle(story: Story): NodeId[] | null {
  const nodes = story.nodes as Readonly<Record<NodeId, StoryNode>>
  const state = new Map<NodeId, 'open' | 'done'>()
  const path: NodeId[] = []

  const visit = (id: NodeId): NodeId[] | null => {
    const mark = state.get(id)
    if (mark === 'done') return null
    if (mark === 'open') return [...path.slice(path.indexOf(id)), id]
    const node = nodes[id]
    if (!node) return null
    state.set(id, 'open')
    path.push(id)
    for (const to of targetsOf(id, node)) {
      const found = visit(to)
      if (found) return found
    }
    path.pop()
    state.set(id, 'done')
    return null
  }

  for (const id of Object.keys(nodes)) {
    const found = visit(id)
    if (found) return found
  }
  return null
}

/**
 * Every path a visitor can take from the start to an ending, following the
 * routes the flags actually pick. Stops after `limit` paths, since merging
 * branches multiply. Call it only on a story that validates.
 */
export function enumeratePaths(story: Story, limit = 10_000): Step[][] {
  const nodes = story.nodes as Readonly<Record<NodeId, StoryNode>>
  const paths: Step[][] = []

  const walk = (history: Step[]): void => {
    if (paths.length >= limit) return
    const id = history[history.length - 1]!.node
    const node = nodes[id]!
    if (node.kind === 'ending') {
      paths.push(history)
      return
    }
    if (node.kind === 'choice') {
      for (const option of node.options) {
        const answered = [
          ...history.slice(0, -1),
          { node: id, option: option.id },
        ]
        const to = resolveNext(option.next, flagsOf(story, answered))!
        walk([...answered, { node: to }])
      }
      return
    }
    const to = resolveNext(node.next, flagsOf(story, history))!
    walk([...history, { node: to }])
  }

  walk([{ node: story.start }])
  return paths
}

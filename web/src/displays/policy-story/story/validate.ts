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
  Paragraph,
  Part,
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

/** The parts of a paragraph, whether it is one text, one condition or a list. */
function partsOf(paragraph: Paragraph): readonly Part[] {
  return typeof paragraph === 'string' || 'text' in paragraph
    ? [paragraph]
    : paragraph
}

/** Every paragraph on `node` that the visitor reads: its text and its replies. */
function paragraphsOf(node: StoryNode): readonly Paragraph[] {
  if (node.kind !== 'choice') return node.body
  return [...node.body, ...node.options.flatMap((o) => o.reply ?? [])]
}

/** The flags a screen sets when it is left: its button's, or its answers'. */
function setsOf(node: StoryNode): Flag[] {
  if (node.kind === 'choice') return node.options.flatMap((o) => o.sets ?? [])
  if (node.kind === 'ending') return []
  return [...(node.sets ?? [])]
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
  const keysRead = new Set<string>()

  for (const id of ids) {
    const node = nodes[id]!
    for (const paragraph of paragraphsOf(node)) {
      for (const part of partsOf(paragraph)) {
        if (typeof part !== 'string') flagsRead(part.when, read)
        const text = typeof part === 'string' ? part : part.text
        for (const [, key] of text.matchAll(/\{([\w-]+)\}/g)) {
          keysRead.add(key!)
        }
      }
    }
    for (const flag of setsOf(node)) set.add(flag)
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

  const valueKeys = new Set(
    [...set].filter((flag) => flag.includes('=')).map((f) => f.split('=')[0]!),
  )
  for (const flag of read) {
    if (!set.has(flag)) errors.push(`the flag "${flag}" is read but never set`)
  }
  for (const key of keysRead) {
    if (!valueKeys.has(key)) {
      errors.push(`the text reads "{${key}}", but no flag "${key}=…" is set`)
    }
  }
  for (const flag of set) {
    const key = flag.includes('=') ? flag.split('=')[0]! : null
    if (!read.has(flag) && !(key && keysRead.has(key)))
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

/** What {@link searchStates} found. */
export interface StateSearch {
  /** The shortest path to a state `goal` accepted, or null. */
  found: Step[] | null
  /** Every screen some state stands on. */
  reached: Set<NodeId>
  /** How many screen and flag combinations were visited. */
  states: number
  /** True when the search stopped at `limit` before it had seen everything. */
  truncated: boolean
}

interface State {
  node: NodeId
  flags: Set<Flag>
  parent: State | null
  /** The answer picked on `parent` to get here. */
  via?: string
}

/**
 * Visits every combination of a screen and the flags set on the way to it,
 * breadth first, so the first state `goal` accepts is on a shortest path. Two
 * paths that arrive with the same flags are one state, which keeps a long story
 * with many remembered choices small where listing its paths would not be. Call
 * it only on a story that validates.
 */
export function searchStates(
  story: Story,
  goal: (node: NodeId, flags: ReadonlySet<Flag>) => boolean = () => false,
  limit = 500_000,
): StateSearch {
  const nodes = story.nodes as Readonly<Record<NodeId, StoryNode>>
  const key = (node: NodeId, flags: Set<Flag>): string =>
    `${node}|${[...flags].sort().join(',')}`

  const start: State = { node: story.start, flags: new Set(), parent: null }
  const seen = new Set([key(start.node, start.flags)])
  const reached = new Set<NodeId>([start.node])
  const queue: State[] = [start]
  let found: Step[] | null = null
  let truncated = false

  const path = (state: State): Step[] => {
    const steps: Step[] = []
    for (let s: State | null = state; s; s = s.parent) {
      steps.push({ node: s.node })
    }
    steps.reverse()
    const chain: State[] = []
    for (let s: State | null = state; s; s = s.parent) chain.unshift(s)
    chain.forEach((s, i) => {
      if (s.via !== undefined) steps[i - 1]!.option = s.via
    })
    return steps
  }

  const visit = (
    from: State,
    flags: Set<Flag>,
    next: Next,
    via?: string,
  ): void => {
    const to = resolveNext(next, flags)!
    const id = key(to, flags)
    if (seen.has(id)) return
    if (seen.size >= limit) {
      truncated = true
      return
    }
    seen.add(id)
    reached.add(to)
    queue.push({ node: to, flags, parent: from, via })
  }

  for (let head = 0; head < queue.length; head++) {
    const state = queue[head]!
    if (goal(state.node, state.flags)) {
      found = path(state)
      break
    }
    const node = nodes[state.node]!
    if (node.kind === 'ending') continue
    if (node.kind === 'choice') {
      for (const option of node.options) {
        const flags = new Set([...state.flags, ...(option.sets ?? [])])
        visit(state, flags, option.next, option.id)
      }
    } else {
      const flags = new Set([...state.flags, ...(node.sets ?? [])])
      visit(state, flags, node.next)
    }
  }
  return { found, reached, states: seen.size, truncated }
}

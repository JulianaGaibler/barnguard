/**
 * One visitor's way through a story.
 *
 * A run keeps only the path: which screens were shown and which answer was
 * picked on each. Flags are derived from that path, so stepping back undoes an
 * answer's flags with nothing else to unwind.
 */
import type {
  Condition,
  Flag,
  Next,
  NodeId,
  Paragraph,
  Story,
  StoryNode,
} from './types'

/** A screen on the path, with the answer picked there if it was a choice. */
export interface Step {
  node: NodeId
  option?: string
}

/** One mark in the progress row. */
export interface ProgressMark {
  kind: 'step' | 'moment'
  current: boolean
}

/** Whether `condition` holds for `flags`. */
export function holds(condition: Condition, flags: ReadonlySet<Flag>): boolean {
  if ('flag' in condition) return flags.has(condition.flag)
  if ('not' in condition) return !holds(condition.not, flags)
  if ('all' in condition) return condition.all.every((c) => holds(c, flags))
  return condition.any.some((c) => holds(c, flags))
}

/** The screen `next` leads to for `flags`, or null when no route matches. */
export function resolveNext(
  next: Next,
  flags: ReadonlySet<Flag>,
): NodeId | null {
  if (typeof next === 'string') return next
  for (const route of next) {
    if (!route.when || holds(route.when, flags)) return route.to
  }
  return null
}

/** The paragraphs of `body` that show for `flags`. */
export function visibleText(
  body: readonly Paragraph[],
  flags: ReadonlySet<Flag>,
): string[] {
  const shown: string[] = []
  for (const paragraph of body) {
    if (typeof paragraph === 'string') shown.push(paragraph)
    else if (holds(paragraph.when, flags)) shown.push(paragraph.text)
  }
  return shown
}

/**
 * A run is immutable. Each move returns a new run, so a component can hold one
 * in a single reactive variable and swap it.
 */
export class Run {
  readonly story: Story
  /** The path so far, ending at the current screen. */
  readonly history: readonly Step[]

  constructor(story: Story, history: readonly Step[] = []) {
    this.story = story
    this.history = history.length ? history : [{ node: story.start }]
    for (const step of this.history) this.#node(step.node)
  }

  get currentId(): NodeId {
    return this.history[this.history.length - 1]!.node
  }

  get current(): StoryNode {
    return this.#node(this.currentId)
  }

  /** Every flag the answers on the path have set. */
  get flags(): ReadonlySet<Flag> {
    return flagsOf(this.story, this.history)
  }

  /** True on the first screen, where Back leaves the story. */
  get atStart(): boolean {
    return this.history.length === 1
  }

  /** True on an ending, where the run stops. */
  get atEnd(): boolean {
    return this.current.kind === 'ending'
  }

  /** Pick an answer on the current choice and move on. */
  choose(optionId: string): Run {
    const node = this.current
    if (node.kind !== 'choice') {
      throw new Error(`"${this.currentId}" is not a choice`)
    }
    const option = node.options.find((o) => o.id === optionId)
    if (!option) {
      throw new Error(`"${this.currentId}" has no option "${optionId}"`)
    }
    const answered = [
      ...this.history.slice(0, -1),
      { node: this.currentId, option: optionId },
    ]
    return this.#advance(answered, option.next)
  }

  /** Move on from a scene or moment. */
  continue(): Run {
    const node = this.current
    if (node.kind !== 'scene' && node.kind !== 'moment') {
      throw new Error(`"${this.currentId}" has no Continue`)
    }
    return this.#advance(this.history, node.next)
  }

  /** Step back one screen, forgetting the answer given there. */
  back(): Run {
    if (this.atStart) return this
    const kept = this.history.slice(0, -1)
    kept[kept.length - 1] = { node: kept[kept.length - 1]!.node }
    return new Run(this.story, kept)
  }

  /** The current screen's paragraphs for the flags set so far. */
  text(): string[] {
    return visibleText(this.current.body, this.flags)
  }

  /**
   * One mark per screen shown after the opening one, the last one current. The
   * opening screen sets the scene and is not part of the journey.
   */
  progress(): ProgressMark[] {
    return this.history.slice(1).map((step, i) => ({
      kind: this.#node(step.node).kind === 'moment' ? 'moment' : 'step',
      current: i === this.history.length - 2,
    }))
  }

  #advance(history: readonly Step[], next: Next): Run {
    const to = resolveNext(next, flagsOf(this.story, history))
    if (to === null) {
      throw new Error(`no route matches from "${this.currentId}"`)
    }
    return new Run(this.story, [...history, { node: to }])
  }

  #node(id: NodeId): StoryNode {
    const node = this.story.nodes[id]
    if (!node) throw new Error(`the story has no node "${id}"`)
    return node
  }
}

/** The flags the answers along `history` set. */
export function flagsOf(story: Story, history: readonly Step[]): Set<Flag> {
  const flags = new Set<Flag>()
  for (const step of history) {
    if (step.option === undefined) continue
    const node = story.nodes[step.node]
    if (node?.kind !== 'choice') continue
    const option = node.options.find((o) => o.id === step.option)
    for (const flag of option?.sets ?? []) flags.add(flag)
  }
  return flags
}

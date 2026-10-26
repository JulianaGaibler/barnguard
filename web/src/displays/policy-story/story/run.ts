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
  Part,
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

/**
 * The values of the remembered choices written `key=value`, the last one set
 * winning.
 */
export function valuesOf(flags: ReadonlySet<Flag>): Map<string, string> {
  const values = new Map<string, string>()
  for (const flag of flags) {
    const at = flag.indexOf('=')
    if (at > 0) values.set(flag.slice(0, at), flag.slice(at + 1))
  }
  return values
}

/** `text` with each `{key}` replaced by the value of that choice. */
export function fill(
  text: string,
  values: ReadonlyMap<string, string>,
): string {
  return text.replace(/\{([\w-]+)\}/g, (token, key: string) => {
    return values.get(key) ?? token
  })
}

function partText(part: Part, flags: ReadonlySet<Flag>): string | null {
  if (typeof part === 'string') return part
  return holds(part.when, flags) ? part.text : null
}

/**
 * The paragraphs of `body` that show for `flags`, with `{key}` filled in. A
 * paragraph made of parts shows the parts that hold, and none at all when none
 * does.
 */
export function visibleText(
  body: readonly Paragraph[],
  flags: ReadonlySet<Flag>,
): string[] {
  const values = valuesOf(flags)
  const shown: string[] = []
  for (const paragraph of body) {
    const text =
      typeof paragraph === 'string' || 'text' in paragraph
        ? partText(paragraph, flags)
        : paragraph
            .map((part) => partText(part, flags))
            .filter((part): part is string => part !== null)
            .join(' ')
    if (text) shown.push(fill(text, values))
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

  /** True once a screen on the path has dropped the progress row. */
  get trailDropped(): boolean {
    return this.history.some((step) => this.#node(step.node).dropsTrail)
  }

  /**
   * True while the screens are set as a narrative: the progress row has gone
   * and the current screen does not restore the look of the booth.
   */
  get narrated(): boolean {
    return this.trailDropped && !this.current.restoresLook
  }

  /** The mood of the last screen on the path that names one. */
  get mood(): string | undefined {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const mood = this.#node(this.history[i]!.node).mood
      if (mood !== undefined) return mood
    }
    return undefined
  }

  /** The agitation of the last screen on the path that names one, else 1. */
  get agitation(): number {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const agitation = this.#node(this.history[i]!.node).agitation
      if (agitation !== undefined) return agitation
    }
    return 1
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
    return this.#advance(this.history, node.next, true)
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
   * What the answer that led here sends back, to show above the text. Empty on
   * a screen reached without an answer, or by an answer with no reply.
   */
  reply(): string[] {
    const before = this.history[this.history.length - 2]
    if (!before || before.option === undefined) return []
    const node = this.#node(before.node)
    if (node.kind !== 'choice') return []
    const option = node.options.find((o) => o.id === before.option)
    return visibleText(option?.reply ?? [], this.flags)
  }

  /**
   * One mark per screen shown after the opening one, the last one current. The
   * opening screen sets the scene and is not part of the journey.
   */
  progress(): ProgressMark[] {
    if (this.trailDropped) return []
    return this.history.slice(1).map((step, i) => ({
      kind: this.#node(step.node).kind === 'moment' ? 'moment' : 'step',
      current: i === this.history.length - 2,
    }))
  }

  #advance(history: readonly Step[], next: Next, pressed = false): Run {
    const to = resolveNext(next, flagsOf(this.story, history, pressed))
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

/**
 * The flags the answers along `history` set, and the flags of the buttons
 * pressed on the way. The button of the screen the history ends on counts only
 * when `pressed` says it was pressed.
 */
export function flagsOf(
  story: Story,
  history: readonly Step[],
  pressed = false,
): Set<Flag> {
  const flags = new Set<Flag>()
  history.forEach((step, i) => {
    const node = story.nodes[step.node]
    if (node?.kind === 'scene' || node?.kind === 'moment') {
      if (i < history.length - 1 || pressed) {
        for (const flag of node.sets ?? []) flags.add(flag)
      }
      return
    }
    if (step.option === undefined || node?.kind !== 'choice') return
    const option = node.options.find((o) => o.id === step.option)
    for (const flag of option?.sets ?? []) flags.add(flag)
  })
  return flags
}

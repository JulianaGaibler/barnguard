/**
 * The shape of a story: screens joined into a directed acyclic graph.
 *
 * Paths can split and meet again, so a screen reached several ways can't tell
 * from its position alone what the visitor chose. Choices set flags instead,
 * and later routing and paragraphs read them.
 */

export type NodeId = string
export type Flag = string

/** A test against the flags set so far. */
export type Condition =
  | { flag: Flag }
  | { not: Condition }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }

/** A paragraph, shown always or only when its condition holds. */
export type Paragraph = string | { when: Condition; text: string }

/** One possible next screen. Without `when` it always matches. */
export interface Route<Id extends string = NodeId> {
  when?: Condition
  to: Id
}

/**
 * Where a screen leads. A list is read top to bottom and the first match wins,
 * so it ends with an entry that has no `when`.
 */
export type Next<Id extends string = NodeId> = Id | readonly Route<Id>[]

/** An image shown beside the text. `src` is an imported asset URL. */
export interface Illustration {
  src: string
  alt: string
}

/** Text with a Continue button, such as the opening scenario. */
export interface SceneNode<Id extends string = NodeId> {
  kind: 'scene'
  body: readonly Paragraph[]
  illustration?: Illustration
  next: Next<Id>
}

/** A consequence or an event, with no choice to make. */
export interface MomentNode<Id extends string = NodeId> {
  kind: 'moment'
  body: readonly Paragraph[]
  illustration?: Illustration
  next: Next<Id>
}

/** A question with two to four answers, lettered from A. */
export interface ChoiceNode<Id extends string = NodeId> {
  kind: 'choice'
  body: readonly Paragraph[]
  options: readonly ChoiceOption<Id>[]
}

export interface ChoiceOption<Id extends string = NodeId> {
  /** Unique within its choice, and stable, since history refers to it. */
  id: string
  label: string
  /** Flags this answer sets for the rest of the run. */
  sets?: readonly Flag[]
  next: Next<Id>
}

/** A conclusion. The run stops here. */
export interface EndingNode {
  kind: 'ending'
  title?: string
  body: readonly Paragraph[]
  illustration?: Illustration
}

export type StoryNode<Id extends string = NodeId> =
  SceneNode<Id> | MomentNode<Id> | ChoiceNode<Id> | EndingNode

export interface Story<Id extends string = NodeId> {
  start: Id
  nodes: Readonly<Record<Id, StoryNode<Id>>>
}

/**
 * Build a story with every link checked against its own node ids, so a typo in
 * `next` or `to` fails to compile.
 */
export function defineStory<const Id extends string>(
  story: Story<Id>,
): Story<Id> {
  return story
}

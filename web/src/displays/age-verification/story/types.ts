/**
 * The shape of a story: screens joined into a graph.
 *
 * Paths can split and meet again, so a screen reached several ways can't tell
 * from its position alone what the visitor chose. Choices set flags instead,
 * and later routing and paragraphs read them. A path may come back to a screen
 * when flags change what it offers, such as a hub that hides each meeting once
 * heard. A path that comes back with the same flags would never end, and the
 * validator reports it.
 */

import type { DitherPresetName, DitherSettings } from '@src/core/render/dither'

export type NodeId = string
export type Flag = string

/** A test against the flags set so far. */
export type Condition =
  | { flag: Flag }
  | { not: Condition }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }

/**
 * A paragraph, shown always or only when its condition holds. Text can carry
 * `**bold**` around a word or phrase to stress, for a few words a screen.
 */
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
  /**
   * How the image is dithered: the name of a preset, or settings laid over the
   * display's own. A preset brings its colors with it. Left out, the display's
   * look applies.
   */
  dither?: IllustrationDither
}

/** A way to dither one illustration. See {@link Illustration.dither}. */
export type IllustrationDither = DitherPresetName | Partial<DitherSettings>

/** One of a few points set side by side, as a card. */
export interface InfoCard {
  /** A short heading over the card's text. */
  title?: string
  text: string
}

/** Text with a Continue button, such as the opening scenario or a consequence. */
export interface SceneNode<Id extends string = NodeId> {
  kind: 'scene'
  /** A heading over the text, such as who is speaking. */
  title?: string
  body: readonly Paragraph[]
  /**
   * Two to four points under the text, set side by side as cards, or stacked on
   * a portrait screen. A screen with an illustration shows no cards.
   */
  cards?: readonly InfoCard[]
  illustration?: Illustration
  next: Next<Id>
}

/**
 * How a choice sets its answers. Without one they are a lettered list.
 *
 * - `people`: a row of figures, one per answer, for who to talk to.
 * - `folders`: a stack of folders, each with its label on the tab and its
 *   description inside, for information on a few topics.
 */
export type ChoicePresentation = 'people' | 'folders'

/**
 * A question with two to four answers, lettered from A. An answer with a `when`
 * shows only while it holds, so a screen can come back with fewer answers, and
 * at least one has to show on every path.
 */
export interface ChoiceNode<Id extends string = NodeId> {
  kind: 'choice'
  /** A heading over the text. */
  title?: string
  body: readonly Paragraph[]
  presentation?: ChoicePresentation
  options: readonly ChoiceOption<Id>[]
}

export interface ChoiceOption<Id extends string = NodeId> {
  /** Unique within its choice, and stable, since history refers to it. */
  id: string
  label: string
  /** A line under the label, on a card or a long answer. */
  description?: string
  /** The answer shows only when this holds. Without it, it always shows. */
  when?: Condition
  /**
   * The answer shows as taken, and can't be picked, while this holds. It still
   * counts as showing, so a choice with every answer taken has nothing to pick
   * and the story has to lead away before that.
   */
  done?: Condition
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
  SceneNode<Id> | ChoiceNode<Id> | EndingNode

/** The picture a screen shows, or `null` for a screen with none. */
export function illustrationOf<Id extends string>(
  node: StoryNode<Id>,
): Illustration | null {
  return node.kind === 'choice' ? null : (node.illustration ?? null)
}

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

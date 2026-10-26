/**
 * The shape of a story: screens joined into a directed acyclic graph.
 *
 * Paths can split and meet again, so a screen reached several ways can't tell
 * from its position alone what the visitor chose. Choices set flags instead,
 * and later routing and paragraphs read them.
 */

import type { DitherPresetName, DitherSettings } from '@src/core/render/dither'

export type NodeId = string

/**
 * A remembered choice. A plain flag such as `strict` is either set or not. A
 * flag written `key=value`, such as `name=June`, is a choice with a value: the
 * text can read it as `{name}` and conditions can test `name=June`.
 */
export type Flag = string

/** A test against the flags set so far. */
export type Condition =
  | { flag: Flag }
  | { not: Condition }
  | { all: readonly Condition[] }
  | { any: readonly Condition[] }

/** Text shown always, or only when its condition holds. */
export type Part = string | { when: Condition; text: string }

/**
 * A paragraph, shown always or only when its condition holds. A list is a
 * paragraph made of parts, joined with a space, so one sentence can change with
 * a flag while the rest stays. The text can hold `{key}`, which becomes the
 * value of the remembered choice `key`, see {@link Flag}.
 */
export type Paragraph = Part | readonly Part[]

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

/** How fast a screen's lines arrive. `together` is all at once. */
export type Pace = 'together' | 'beats' | 'slow'

/** How a button looks. A thought is italic and small, and `small` is small. */
export type ButtonStyle = 'plain' | 'small' | 'thought'

/** What every kind of screen can carry. */
interface ScreenFields {
  /** A time marker above the text, such as "June. 5 months to the election." */
  label?: string
  /**
   * The look of the background and the type, by the name of a mood. It holds
   * until a later screen on the path names another.
   */
  mood?: string
  /**
   * How much of the mood's shake plays, 0 to 1. A mood that shakes starts calm
   * and grows more agitated screen by screen. It holds until a later screen on
   * the path names another, and is 1 when none does.
   */
  agitation?: number
  /**
   * True to swell a soft warm circle in the middle of the background as the
   * screen arrives, which grows and fades away again. A mood with the fields
   * for it must be showing.
   */
  touch?: boolean
  /** How the lines arrive. Default `together`. */
  pace?: Pace
  /** True to show the screen at once, with no slide or fade. */
  cut?: boolean
  /** Seconds the button waits before it shows, so the last line can land. */
  hold?: number
  /** True on the screen from which the progress row is gone for good. */
  dropsTrail?: boolean
  /**
   * True on a screen that is set as the story was before it turned into a
   * narrative: aligned to the start, and with the answers beside the text. The
   * mood still comes from `mood`.
   */
  restoresLook?: boolean
}

/** What a screen with a single button carries. */
interface ButtonFields {
  /** The button's words. Default "Continue". */
  button?: string
  buttonStyle?: ButtonStyle
  /** Flags set when the button is pressed. */
  sets?: readonly Flag[]
}

/** Text with a button, such as the opening scenario. */
export interface SceneNode<Id extends string = NodeId>
  extends ScreenFields, ButtonFields {
  kind: 'scene'
  body: readonly Paragraph[]
  illustration?: Illustration
  next: Next<Id>
  /**
   * Fades the screen to black, slowly, when the button is pressed, and then
   * cuts to the next screen, which should be `cut` so it shows whole.
   */
  fadeOut?: boolean
}

/** A consequence or an event, with no choice to make. */
export interface MomentNode<Id extends string = NodeId>
  extends ScreenFields, ButtonFields {
  kind: 'moment'
  body: readonly Paragraph[]
  illustration?: Illustration
  next: Next<Id>
  /** As on a scene: fades to black, then cuts to the next screen. */
  fadeOut?: boolean
}

/** A question with two to four answers. */
export interface ChoiceNode<Id extends string = NodeId> extends ScreenFields {
  kind: 'choice'
  body: readonly Paragraph[]
  /** An instruction under the text, such as "Choose who you meet first." */
  prompt?: string
  options: readonly ChoiceOption<Id>[]
}

export interface ChoiceOption<Id extends string = NodeId> {
  /** Unique within its choice, and stable, since history refers to it. */
  id: string
  label: string
  /** Flags this answer sets for the rest of the run. */
  sets?: readonly Flag[]
  /**
   * What comes back for this answer. It shows above the text of the screen the
   * answer leads to, and can change with the flags like any text.
   */
  reply?: readonly Paragraph[]
  style?: 'plain' | 'thought'
  next: Next<Id>
}

/** A conclusion. The run stops here. */
export interface EndingNode extends ScreenFields {
  kind: 'ending'
  title?: string
  body: readonly Paragraph[]
  illustration?: Illustration
  /** The button's words. Default "Start over". */
  button?: string
  buttonStyle?: ButtonStyle
  /**
   * Fades the screen to black when the button is pressed, stays dark for a
   * moment, and then returns to the splash.
   */
  fadeOut?: boolean
}

export type StoryNode<Id extends string = NodeId> =
  SceneNode<Id> | MomentNode<Id> | ChoiceNode<Id> | EndingNode

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

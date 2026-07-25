import type { SceneNode } from '../scene/SceneNode'

/**
 * ARIA role a semantic node maps to. Determines the generated element's tag or
 * `role` attribute and how it takes part in keyboard navigation. Roles with a
 * native HTML equivalent (`button`, `link`, `heading`) render as that element
 * so the browser supplies keyboard behavior; the rest render as a `<div>`/`<a>`
 * with an explicit `role`.
 *
 * @category A11y
 */
export type A11yRole =
  | 'button'
  | 'checkbox'
  | 'radio'
  | 'link'
  | 'heading'
  | 'group'
  | 'grid'
  | 'gridcell'
  | 'row'
  | 'radiogroup'
  | 'listbox'
  | 'option'
  | 'toolbar'
  | 'region'
  | 'application'
  | 'status'

/**
 * Live-region urgency. `polite` waits for a pause; `assertive` interrupts.
 *
 * @category A11y
 */
export type Politeness = 'polite' | 'assertive'

/**
 * The ARIA relationship a {@link A11yLink} expresses between a canvas node's
 * proxy and a real HTML element elsewhere in the page (typically an overlay
 * attached via `engine.dom`). Maps to `aria-controls` / `aria-labelledby` /
 * `aria-describedby` / `aria-details` / `aria-flowto`.
 *
 * @category A11y
 */
export type A11yRelation =
  'controls' | 'labelledBy' | 'describedBy' | 'details' | 'flowTo'

/**
 * Connects a canvas node's proxy to a real HTML element without merging the two
 * into one accessibility tree. `target` is a stable DOM id string (preferred,
 * so no app-owned DOM is mutated) or an `HTMLElement` (an id is assigned only
 * if it lacks one). An unresolved id is written verbatim; the browser resolves
 * it once the target mounts.
 *
 * @category A11y
 */
export interface A11yLink {
  relation: A11yRelation
  target: HTMLElement | string
}

/**
 * Boolean/tri-state flags mapped onto the proxy's `aria-*` attributes:
 * `aria-checked`, `aria-selected`, `aria-pressed`, `aria-expanded`,
 * `aria-current`.
 *
 * @category A11y
 */
export interface A11yStates {
  checked?: boolean
  selected?: boolean
  pressed?: boolean
  expanded?: boolean
  current?: boolean | 'page' | 'step' | 'location'
}

/**
 * Optional accessibility description of a {@link SceneNode}. Attach it with
 * {@link AccessibilityTree.attach}; the subsystem mirrors every attached node
 * into a hidden, screen-reader-readable HTML element so a canvas scene reads
 * like a normal accessibility tree. A node with no attached `Semantics` is
 * absent from the tree, so decorative content is hidden by simply not
 * registering it.
 *
 * @category A11y
 */
export interface Semantics {
  /** The ARIA role. Drives the generated element and keyboard behavior. */
  role: A11yRole
  /** Accessible name (`aria-label`). */
  label?: string
  /** Extended description (`aria-description`). */
  description?: string
  /**
   * Human phrase that overrides how AT announces the role
   * (`aria-roledescription`). Use sparingly.
   */
  roleDescription?: string
  /** Numeric or string value (`aria-valuenow` / textContent for status). */
  value?: number | string
  /** Human-readable form of `value` (`aria-valuetext`), e.g. "medium" for 2. */
  valueText?: string
  /** Turn the proxy into a live region announcing its own changes. */
  live?: Politeness
  /** Reflected as `aria-disabled`. */
  disabled?: boolean
  /** Boolean/tri-state flags; see {@link A11yStates}. */
  states?: A11yStates
  /** For `role: 'heading'`, the heading level (renders `<h1>`..`<h6>`). */
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6
  /** Position within a set (`aria-posinset`), 1-based. */
  posInSet?: number
  /** Size of the set this node belongs to (`aria-setsize`). */
  setSize?: number
  /**
   * Tiebreak ordering among siblings under the same parent. Defaults to 0;
   * scene painter (pre-order) position breaks ties, so leave it unset to read
   * in tree order.
   */
  order?: number
  /** Relationships to real HTML elements elsewhere in the page. */
  links?: A11yLink[]
  /** Invoked when the proxy is activated (click, or Enter/Space when focused). */
  onActivate?(): void
  /** Invoked when the proxy gains focus (draw a focus ring on the node here). */
  onFocus?(): void
  /** Invoked when the proxy loses focus. */
  onBlur?(): void
}

/**
 * Handle returned by {@link AccessibilityTree.attach}. Keep it to update the
 * node's semantics or to detach.
 *
 * @category A11y
 */
export interface SemanticsHandle {
  /** The node these semantics describe. */
  readonly node: SceneNode
  /** The generated proxy element. Reference stays stable unless `role` changes. */
  readonly element: HTMLElement
  /** Merge `next` into the current semantics and schedule a reconcile. */
  update(next: Partial<Semantics>): void
  /** Stop mirroring this node and remove its proxy. Idempotent. */
  detach(): void
}

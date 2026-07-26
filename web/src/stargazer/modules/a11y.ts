/**
 * Optional accessibility layer for canvas scene graphs.
 * {@link AccessibilityTree} (reached as `engine.a11y`) mirrors registered scene
 * nodes into a hidden, screen-reader-readable HTML tree so an interactive scene
 * reads like a normal accessibility tree. Attach {@link Semantics} to a node
 * with `engine.a11y.attach`; link to real overlay HTML (menus, HUD) with
 * {@link A11yLink} relationship attributes rather than merging the two trees.
 * The subsystem is created only on first use, so an engine that never touches
 * it (a touchscreen kiosk) pays nothing. From Svelte, mount the hidden root
 * with the `a11yRoot` action (see the svelte module). See the accessibility
 * guide.
 *
 * @module a11y
 * @category A11y
 */
export { AccessibilityTree } from '../a11y/AccessibilityTree'
export type {
  Semantics,
  SemanticsHandle,
  A11yRole,
  A11yStates,
  A11yLink,
  A11yRelation,
  Politeness,
} from '../a11y/types'

import type { Node2D } from '../scene/Node2D'
import type { Semantics } from './types'

/**
 * The two linear, reference-preserving passes that turn the flat set of
 * registered nodes into a correctly-nested, correctly-ordered DOM tree without
 * a virtual DOM. Elements are moved, never recreated, so focus and other
 * element state survive.
 */

/** Minimal view of a registered node the reconciler needs. */
export interface ReconcileEntry {
  node: Node2D
  element: HTMLElement
  semantics: Semantics
}

/** Whether `ancestor` is a strict scene-graph ancestor of `node`. */
function isAncestor(ancestor: Node2D, node: Node2D): boolean {
  let p = node.parent
  while (p) {
    if (p === ancestor) return true
    p = p.parent
  }
  return false
}

/**
 * Ordering/reparenting pass. Align `parent`'s actual DOM children to `expected`
 * with a single `insertBefore` walk — `insertBefore` on an element already in
 * the document moves it, so a reparent is one atomic mutation that keeps the
 * element (and its focus) intact. A trailing child is removed only when it is
 * genuinely orphaned (`!live`); a live child that belongs elsewhere is left for
 * its owning parent's pass to relocate.
 */
export function reconcileChildren(
  parent: Node,
  expected: readonly HTMLElement[],
  live: ReadonlySet<HTMLElement>,
): void {
  let cur = parent.firstChild
  for (const want of expected) {
    if (cur !== want) {
      parent.insertBefore(want, cur)
    } else {
      cur = cur.nextSibling
    }
  }
  while (cur) {
    const next = cur.nextSibling
    if (!(cur instanceof HTMLElement) || !live.has(cur)) {
      parent.removeChild(cur)
    }
    cur = next
  }
}

/**
 * Nesting pass (ancestor stack, O(N)). `ordered` must be in scene painter
 * pre-order. Each registered node attaches under its nearest also-registered
 * ancestor — unregistered intermediates collapse out. Within a parent, entries
 * keep painter order, with `semantics.order` (default 0) as a stable tiebreak.
 * Then the ordering pass aligns the DOM for the content root and every parent.
 */
export function reconcileTree(
  content: HTMLElement,
  ordered: readonly ReconcileEntry[],
): void {
  const rootEntries: ReconcileEntry[] = []
  const childEntriesOf = new Map<HTMLElement, ReconcileEntry[]>()
  const stack: ReconcileEntry[] = []

  for (const entry of ordered) {
    while (
      stack.length > 0 &&
      !isAncestor(stack[stack.length - 1].node, entry.node)
    ) {
      stack.pop()
    }
    const parent = stack[stack.length - 1]
    if (parent) {
      let list = childEntriesOf.get(parent.element)
      if (!list) {
        list = []
        childEntriesOf.set(parent.element, list)
      }
      list.push(entry)
    } else {
      rootEntries.push(entry)
    }
    stack.push(entry)
  }

  const live = new Set<HTMLElement>(ordered.map((e) => e.element))
  const toElements = (entries: ReconcileEntry[]): HTMLElement[] =>
    entries
      .slice()
      .sort((a, b) => (a.semantics.order ?? 0) - (b.semantics.order ?? 0))
      .map((e) => e.element)

  reconcileChildren(content, toElements(rootEntries), live)
  for (const [parentEl, entries] of childEntriesOf) {
    reconcileChildren(parentEl, toElements(entries), live)
  }
}

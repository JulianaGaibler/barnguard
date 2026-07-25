/**
 * Keyboard focus for the accessibility tree: roving `tabindex` so a composite
 * widget (grid/radiogroup/listbox/toolbar) is a single tab stop with arrow-key
 * navigation between its members, plus focus save/restore across a reconcile so
 * an in-place update never drops focus to `<body>`.
 *
 * Composite containers are marked `data-a11y-composite="1"` and focusable
 * proxies `data-a11y-focusable="1"` by the element patcher; every proxy carries
 * its node id in `data-a11y-id`.
 */

/** Where an arrow/Home/End key moves within a roving group. */
export type NavDirection = 'next' | 'prev' | 'first' | 'last'

/** Map a key to a navigation direction, or null if it isn't a nav key. */
export function navDirection(key: string): NavDirection | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return 'next'
    case 'ArrowLeft':
    case 'ArrowUp':
      return 'prev'
    case 'Home':
      return 'first'
    case 'End':
      return 'last'
    default:
      return null
  }
}

/** Nearest composite-container ancestor of `el`, or null. */
export function nearestComposite(el: HTMLElement): HTMLElement | null {
  let p = el.parentElement
  while (p) {
    if (p.dataset.a11yComposite === '1') return p
    p = p.parentElement
  }
  return null
}

/**
 * Focusable proxies that belong directly to `container` (excluding those inside
 * a deeper nested composite). Returned in document order, which is reading and
 * navigation order.
 */
function ownedFocusables(container: HTMLElement): HTMLElement[] {
  const all = container.querySelectorAll<HTMLElement>('[data-a11y-focusable]')
  const out: HTMLElement[] = []
  for (const el of all) {
    if (nearestComposite(el) === container) out.push(el)
  }
  return out
}

/**
 * Enforce roving `tabindex` on every composite in `content`: exactly one member
 * is a tab stop (`0`), the rest `-1`. Keeps the currently-focused member active
 * if focus is inside; otherwise the last-active one (tracked in `active` keyed
 * by the composite's node id); otherwise the first member.
 */
export function applyRoving(
  content: HTMLElement,
  active: Map<string, string>,
): void {
  const composites = content.querySelectorAll<HTMLElement>(
    '[data-a11y-composite="1"]',
  )
  const focused = document.activeElement
  for (const container of composites) {
    const members = ownedFocusables(container)
    if (members.length === 0) continue
    const cid = container.dataset.a11yId ?? ''

    let activeEl: HTMLElement | null =
      members.find((m) => m.dataset.a11yId === active.get(cid)) ?? null
    if (focused instanceof HTMLElement && members.includes(focused)) {
      activeEl = focused
    }
    if (!activeEl) activeEl = members[0]

    active.set(cid, activeEl.dataset.a11yId ?? '')
    for (const m of members) {
      m.setAttribute('tabindex', m === activeEl ? '0' : '-1')
    }
  }
}

/**
 * The member `dir` selects relative to `current` within its composite, wrapping
 * at the ends. Returns null when `current` isn't in a composite.
 */
export function memberInDirection(
  current: HTMLElement,
  dir: NavDirection,
): HTMLElement | null {
  const container = nearestComposite(current)
  if (!container) return null
  const members = ownedFocusables(container)
  if (members.length === 0) return null
  const i = members.indexOf(current)
  if (i < 0) return members[0]
  switch (dir) {
    case 'next':
      return members[(i + 1) % members.length]
    case 'prev':
      return members[(i - 1 + members.length) % members.length]
    case 'first':
      return members[0]
    case 'last':
      return members[members.length - 1]
  }
}

/** The node id of the focused proxy inside `root`, or null. */
export function focusedNodeId(root: HTMLElement): string | null {
  const a = document.activeElement
  if (a instanceof HTMLElement && root.contains(a)) {
    return a.dataset.a11yId ?? null
  }
  return null
}

/**
 * Re-focus the proxy for `id` inside `content` if it exists and isn't already
 * focused.
 */
export function refocusNode(content: HTMLElement, id: string | null): void {
  if (!id) return
  for (const el of content.querySelectorAll<HTMLElement>('[data-a11y-id]')) {
    if (el.dataset.a11yId === id) {
      if (document.activeElement !== el) el.focus()
      return
    }
  }
}

import type { A11yRole, Politeness, Semantics } from './types'

/**
 * DOM plumbing for the accessibility tree: turning {@link Semantics} into real
 * HTML elements and patching their `aria-*` attributes. Kept separate from the
 * subsystem and the reconciler so the element mapping is unit-testable on its
 * own.
 */

/** Roles that are a focus target (a tab stop or a roving-group member). */
const INTERACTIVE_ROLES: ReadonlySet<A11yRole> = new Set<A11yRole>([
  'button',
  'checkbox',
  'radio',
  'link',
  'gridcell',
  'option',
])

/** Container roles whose focusable descendants rove as a single tab stop. */
const COMPOSITE_ROLES: ReadonlySet<A11yRole> = new Set<A11yRole>([
  'grid',
  'radiogroup',
  'listbox',
  'toolbar',
])

/** Roles whose accessible name is their text content rather than `aria-label`. */
const TEXT_CONTENT_ROLES: ReadonlySet<A11yRole> = new Set<A11yRole>([
  'heading',
  'status',
])

/** Whether a proxy for this role/semantics should be focusable. */
export function isFocusable(sem: Semantics): boolean {
  return INTERACTIVE_ROLES.has(sem.role) || typeof sem.onActivate === 'function'
}

/** Whether this role is a roving-group container. */
export function isComposite(role: A11yRole): boolean {
  return COMPOSITE_ROLES.has(role)
}

/**
 * Whether the element activates on Enter/Space natively (only real
 * `<button>`s). Non-native focusable proxies get keyboard activation from the
 * subsystem's delegated key handler instead, so this guards against a double
 * fire.
 */
export function nativeActivates(el: HTMLElement): boolean {
  return el.tagName === 'BUTTON'
}

const RELATION_ATTR: Record<string, string> = {
  controls: 'aria-controls',
  labelledBy: 'aria-labelledby',
  describedBy: 'aria-describedby',
  details: 'aria-details',
  flowTo: 'aria-flowto',
}

let nextLinkId = 0

/** Resolve a link target to a DOM id, assigning one to a bare element. */
function resolveTargetId(target: HTMLElement | string): string {
  if (typeof target === 'string') {
    return target.startsWith('#') ? target.slice(1) : target
  }
  if (!target.id) target.id = `a11y-link-${nextLinkId++}`
  return target.id
}

/**
 * The tag a role renders as. Native tags come first so the browser supplies
 * behavior.
 */
function tagFor(sem: Semantics): string {
  switch (sem.role) {
    case 'button':
      return 'button'
    case 'link':
      return 'a'
    case 'heading':
      return `h${sem.headingLevel ?? 2}`
    default:
      return 'div'
  }
}

/** The explicit `role` attribute to set, or null when the tag implies it. */
function ariaRoleAttr(role: A11yRole): string | null {
  switch (role) {
    // Native tags carry their role implicitly.
    case 'button':
    case 'heading':
      return null
    // `<a>` without href has no implicit role.
    case 'link':
      return 'link'
    default:
      return role
  }
}

/**
 * Create a fresh proxy element for `sem`. Attributes are applied separately by
 * {@link patchElement} so the same code path serves both create and update.
 */
export function createElement(sem: Semantics): HTMLElement {
  const el = document.createElement(tagFor(sem))
  if (el instanceof HTMLButtonElement) el.type = 'button'
  const role = ariaRoleAttr(sem.role)
  if (role) el.setAttribute('role', role)
  return el
}

/**
 * Whether `el` still matches the tag/role `sem` would produce (else it must be
 * replaced).
 */
export function elementMatches(el: HTMLElement, sem: Semantics): boolean {
  if (el.tagName.toLowerCase() !== tagFor(sem)) return false
  const role = ariaRoleAttr(sem.role)
  return (el.getAttribute('role') ?? null) === role
}

function setOrRemove(
  el: HTMLElement,
  attr: string,
  value: string | null,
): void {
  if (value === null || value === '') el.removeAttribute(attr)
  else el.setAttribute(attr, value)
}

/**
 * Apply every `aria-*` attribute, text, focusability marker, and the
 * `data-a11y-id` back-reference for `sem` onto `el` in place. Reused across
 * frames so element identity (and thus focus) survives semantic changes.
 */
export function patchElement(
  el: HTMLElement,
  sem: Semantics,
  nodeId: string,
): void {
  el.dataset.a11yId = nodeId

  // Accessible name.
  if (TEXT_CONTENT_ROLES.has(sem.role)) {
    const text =
      sem.role === 'status'
        ? (sem.valueText ?? (sem.value != null ? String(sem.value) : sem.label))
        : sem.label
    const next = text ?? ''
    if (el.textContent !== next) el.textContent = next
    setOrRemove(el, 'aria-label', null)
  } else {
    setOrRemove(el, 'aria-label', sem.label ?? null)
  }

  setOrRemove(el, 'aria-description', sem.description ?? null)
  setOrRemove(el, 'aria-roledescription', sem.roleDescription ?? null)

  // Value.
  if (sem.role !== 'status') {
    setOrRemove(
      el,
      'aria-valuenow',
      typeof sem.value === 'number' ? String(sem.value) : null,
    )
    setOrRemove(el, 'aria-valuetext', sem.valueText ?? null)
  }

  setOrRemove(el, 'aria-disabled', sem.disabled ? 'true' : null)

  const s = sem.states
  setOrRemove(el, 'aria-checked', s?.checked != null ? String(s.checked) : null)
  setOrRemove(
    el,
    'aria-selected',
    s?.selected != null ? String(s.selected) : null,
  )
  setOrRemove(el, 'aria-pressed', s?.pressed != null ? String(s.pressed) : null)
  setOrRemove(
    el,
    'aria-expanded',
    s?.expanded != null ? String(s.expanded) : null,
  )
  setOrRemove(el, 'aria-current', s?.current != null ? String(s.current) : null)

  setOrRemove(
    el,
    'aria-posinset',
    sem.posInSet != null ? String(sem.posInSet) : null,
  )
  setOrRemove(
    el,
    'aria-setsize',
    sem.setSize != null ? String(sem.setSize) : null,
  )
  setOrRemove(el, 'aria-live', sem.live ?? null)

  // Relationship links to real elements elsewhere in the page. Group by
  // relation so multiple targets share one space-separated attribute.
  const byRelation = new Map<string, string[]>()
  for (const link of sem.links ?? []) {
    const attr = RELATION_ATTR[link.relation]
    if (!attr) continue
    const ids = byRelation.get(attr) ?? []
    ids.push(resolveTargetId(link.target))
    byRelation.set(attr, ids)
  }
  for (const attr of Object.values(RELATION_ATTR)) {
    setOrRemove(el, attr, byRelation.get(attr)?.join(' ') ?? null)
  }

  // Mark roving-group containers so the focus pass can find their members.
  if (isComposite(sem.role)) el.dataset.a11yComposite = '1'
  else delete el.dataset.a11yComposite

  // Focusability. Composite-child roving overrides tabindex afterwards; the
  // baseline here makes an independent control a natural tab stop.
  if (isFocusable(sem)) {
    el.dataset.a11yFocusable = '1'
    if (!nativeActivates(el) && !el.hasAttribute('tabindex')) {
      el.setAttribute('tabindex', '0')
    }
  } else {
    delete el.dataset.a11yFocusable
    el.removeAttribute('tabindex')
  }
}

/** Elements the subsystem owns inside the app-provided mount. */
export interface A11yRootParts {
  /** Generated semantic tree lives here. */
  content: HTMLElement
  /** Persistent polite live region for {@link AccessibilityTree.announce}. */
  polite: HTMLElement
  /** Persistent assertive live region. */
  assertive: HTMLElement
}

const HIDDEN_STYLE =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;' +
  'border:0;overflow:hidden;clip:rect(0 0 0 0);clip-path:inset(50%);' +
  'white-space:nowrap;'

/**
 * Prepare an app-provided mount element: make it visually hidden but
 * screen-reader readable, and populate it with the content container and the
 * two persistent live regions. Returns the owned parts.
 */
export function buildRoot(mount: HTMLElement): A11yRootParts {
  mount.style.cssText = HIDDEN_STYLE
  const content = document.createElement('div')
  const polite = document.createElement('div')
  polite.setAttribute('aria-live', 'polite')
  polite.setAttribute('aria-atomic', 'true')
  const assertive = document.createElement('div')
  assertive.setAttribute('aria-live', 'assertive')
  assertive.setAttribute('aria-atomic', 'true')
  mount.append(content, polite, assertive)
  return { content, polite, assertive }
}

/** Write a message into a live region so AT announces it. */
export function announceInto(
  parts: A11yRootParts,
  message: string,
  politeness: Politeness,
): void {
  const region = politeness === 'assertive' ? parts.assertive : parts.polite
  // Clearing first lets an identical consecutive message re-announce.
  region.textContent = ''
  region.textContent = message
}

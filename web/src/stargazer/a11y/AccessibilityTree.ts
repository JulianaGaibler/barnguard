import type { Engine } from '../engine/Engine'
import type { Scene } from '../scene/Scene'
import type { SceneNode } from '../scene/SceneNode'
import type { Politeness, Semantics, SemanticsHandle } from './types'
import {
  announceInto,
  buildRoot,
  createElement,
  elementMatches,
  nativeActivates,
  patchElement,
  type A11yRootParts,
} from './element'
import { reconcileTree, type ReconcileEntry } from './reconcile'
import {
  applyRoving,
  focusedNodeId,
  memberInDirection,
  navDirection,
  nearestComposite,
  refocusNode,
} from './focus'

/**
 * Optional accessibility layer for a canvas scene graph. Reached lazily as
 * `engine.a11y`; an engine that never touches it allocates nothing and adds no
 * DOM, so kiosk/touchscreen apps pay nothing.
 *
 * Register a node with {@link AccessibilityTree.attach} and the subsystem
 * mirrors it into a hidden, screen-reader-readable HTML element inside an
 * app-provided mount ({@link AccessibilityTree.mount}). The mirror is rebuilt
 * only when something changes (a handle `update`, an attach/detach, or a node
 * destroy), not per frame. Real overlay HTML (menus, HUD) stays in its own DOM;
 * link a canvas node's proxy to it with `Semantics.links` rather than merging
 * the two trees.
 *
 * The structural template is {@link DomTransformSync} (`engine.dom`): a frame
 * subscription, a registry with per-node destroy listeners, and a `dispose`.
 * Unlike that subsystem it does no per-frame work — screen readers ignore
 * position, so a static scene reconciles zero times.
 *
 * @category A11y
 * @example
 *   const board = engine.a11y.attach(boardNode, {
 *     role: 'grid',
 *     label: 'Board',
 *   })
 *   const cell = engine.a11y.attach(cellNode, {
 *     role: 'gridcell',
 *     label: 'Column 1, empty',
 *     onActivate: () => drop(0),
 *   })
 *   engine.a11y.announce('Red wins!', 'assertive')
 */
export class AccessibilityTree {
  readonly #engine: Engine
  readonly #entries = new Map<SceneNode, Entry>()
  /** Node id → entry, for mapping delegated DOM events back to a node. */
  readonly #byId = new Map<string, Entry>()
  /** Composite node id → active member node id, for roving tabindex. */
  readonly #active = new Map<string, string>()
  readonly #offFrame: () => void

  #mount: HTMLElement | null = null
  #parts: A11yRootParts | null = null
  #removeListeners: (() => void) | null = null
  #dirty = false
  #disposed = false

  constructor(engine: Engine) {
    this.#engine = engine
    this.#offFrame = engine.events.on('frame', () => {
      if (this.#dirty) this.#reconcile()
    })
  }

  /**
   * Give the subsystem the element it fills with the hidden semantic tree. Must
   * be an element the app owns and places where its reading order relative to
   * the canvas is correct (typically a sibling right after the `<canvas>`). The
   * element is made visually hidden but screen-reader readable. From Svelte,
   * prefer the `a11yRoot` action.
   */
  mount(element: HTMLElement): void {
    if (this.#disposed || this.#mount === element) return
    if (this.#mount) this.#teardownMount()
    this.#mount = element
    this.#parts = buildRoot(element)
    this.#installListeners(element)
    this.#dirty = true
  }

  /** The current mount element, or null before {@link AccessibilityTree.mount}. */
  get root(): HTMLElement | null {
    return this.#mount
  }

  /**
   * Hide the whole semantic tree from assistive tech and remove it from the tab
   * order (via `inert` + `aria-hidden`). Call with `true` while an app-owned
   * modal overlay is open so focus traps in the dialog, and `false` on close.
   */
  setInert(inert: boolean): void {
    const el = this.#mount
    if (!el) return
    ;(el as HTMLElement & { inert: boolean }).inert = inert
    if (inert) el.setAttribute('aria-hidden', 'true')
    else el.removeAttribute('aria-hidden')
  }

  /**
   * Register `node` with accessibility `semantics`. Returns a handle to update
   * or detach it. The proxy detaches automatically when the node is destroyed.
   */
  attach(node: SceneNode, semantics: Semantics): SemanticsHandle {
    if (this.#disposed)
      throw new Error('stargazer: attach after a11y dispose()')
    const existing = this.#entries.get(node)
    if (existing) {
      existing.semantics = semantics
      this.#dirty = true
      return existing.handle
    }

    const element = createElement(semantics)
    patchElement(element, semantics, node.id)
    const entry: Entry = {
      node,
      element,
      semantics,
      offDestroy: node.events.on('destroy', () => this.#detach(entry)),
      detached: false,
      handle: null as unknown as SemanticsHandle,
    }
    entry.handle = {
      node,
      get element() {
        return entry.element
      },
      update: (next: Partial<Semantics>): void => {
        if (entry.detached) return
        entry.semantics = { ...entry.semantics, ...next }
        this.#dirty = true
      },
      detach: (): void => this.#detach(entry),
    }
    this.#entries.set(node, entry)
    this.#byId.set(node.id, entry)
    this.#dirty = true
    return entry.handle
  }

  /** Announce a transient message (not bound to a node) via a live region. */
  announce(message: string, politeness: Politeness = 'polite'): void {
    if (this.#parts) announceInto(this.#parts, message, politeness)
  }

  /** Detach everything, remove the frame subscription, and clear the mount. */
  dispose(): void {
    if (this.#disposed) return
    this.#disposed = true
    this.#offFrame()
    for (const entry of this.#entries.values()) entry.offDestroy()
    this.#entries.clear()
    this.#byId.clear()
    this.#active.clear()
    this.#teardownMount()
  }

  #detach(entry: Entry): void {
    if (entry.detached) return
    entry.detached = true
    entry.offDestroy()
    entry.element.remove()
    this.#entries.delete(entry.node)
    this.#byId.delete(entry.node.id)
    this.#dirty = true
  }

  #teardownMount(): void {
    this.#removeListeners?.()
    this.#removeListeners = null
    if (this.#parts) {
      this.#parts.content.remove()
      this.#parts.polite.remove()
      this.#parts.assertive.remove()
    }
    this.#parts = null
    this.#mount = null
  }

  #installListeners(root: HTMLElement): void {
    const entryFromEvent = (e: Event): Entry | undefined => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return undefined
      const proxy = target.closest<HTMLElement>('[data-a11y-id]')
      const id = proxy?.dataset.a11yId
      return id ? this.#byId.get(id) : undefined
    }

    const onClick = (e: Event): void => {
      entryFromEvent(e)?.semantics.onActivate?.()
    }
    const onFocusIn = (e: Event): void => {
      entryFromEvent(e)?.semantics.onFocus?.()
    }
    const onFocusOut = (e: Event): void => {
      entryFromEvent(e)?.semantics.onBlur?.()
    }
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target
      if (!(target instanceof HTMLElement)) return
      const proxy = target.closest<HTMLElement>('[data-a11y-id]')
      if (!proxy) return
      const entry = proxy.dataset.a11yId
        ? this.#byId.get(proxy.dataset.a11yId)
        : undefined
      if (!entry) return

      // Arrow/Home/End move focus within a roving composite.
      const dir = navDirection(e.key)
      if (dir && nearestComposite(proxy)) {
        const next = memberInDirection(proxy, dir)
        if (next) {
          e.preventDefault()
          next.focus()
        }
        return
      }
      // Enter/Space activate a non-native widget; a real <button> fires its own
      // click, so skip it here to avoid a double activation.
      if ((e.key === 'Enter' || e.key === ' ') && !nativeActivates(proxy)) {
        if (entry.semantics.onActivate) {
          e.preventDefault()
          entry.semantics.onActivate()
        }
      }
    }

    root.addEventListener('click', onClick)
    root.addEventListener('focusin', onFocusIn)
    root.addEventListener('focusout', onFocusOut)
    root.addEventListener('keydown', onKeyDown)
    this.#removeListeners = (): void => {
      root.removeEventListener('click', onClick)
      root.removeEventListener('focusin', onFocusIn)
      root.removeEventListener('focusout', onFocusOut)
      root.removeEventListener('keydown', onKeyDown)
    }
  }

  #reconcile(): void {
    const parts = this.#parts
    const mount = this.#mount
    if (!parts || !mount) return // wait for a mount

    const focusId = focusedNodeId(mount)

    // Patch attributes in place; replace only when a role change forces a new
    // tag/role (element identity, and thus focus, survives everything else).
    for (const entry of this.#entries.values()) {
      if (!elementMatches(entry.element, entry.semantics)) {
        entry.element = createElement(entry.semantics)
      }
      patchElement(entry.element, entry.semantics, entry.node.id)
    }

    const order = this.#computeOrder()
    const ordered: ReconcileEntry[] = [...this.#entries.values()].sort(
      (a, b) =>
        (order.get(a.node) ?? Infinity) - (order.get(b.node) ?? Infinity),
    )

    reconcileTree(parts.content, ordered)
    applyRoving(parts.content, this.#active)
    refocusNode(parts.content, focusId)
    this.#dirty = false
  }

  /**
   * Global pre-order index per registered node, so entries sort into reading
   * order. Concatenates each involved scene's painter order (primary first); a
   * node's ancestors share its scene and precede it, keeping the reconciler's
   * ancestor-stack invariant.
   */
  #computeOrder(): Map<SceneNode, number> {
    const scenes = new Set<Scene>()
    const primary = this.#engine.scene
    scenes.add(primary)
    for (const entry of this.#entries.values()) {
      if (entry.node.scene) scenes.add(entry.node.scene)
    }
    const order = new Map<SceneNode, number>()
    let i = 0
    for (const scene of scenes) {
      for (const node of scene.getPainterOrder()) order.set(node, i++)
    }
    return order
  }
}

interface Entry {
  node: SceneNode
  element: HTMLElement
  semantics: Semantics
  offDestroy: () => void
  detached: boolean
  handle: SemanticsHandle
}

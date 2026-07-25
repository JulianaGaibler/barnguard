import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Engine } from '../engine/Engine'
import { SceneNode } from '../scene/SceneNode'
import { MockGfxDevice } from '../render/gfx/webgl2/mockGfxDevice'

/**
 * happy-dom's `<canvas>` doesn't return a real WebGL2 context, but `GpuGfx`
 * only needs it for `canvas.width` / `canvas.height` bookkeeping and the FBO
 * blit destination; all GL calls go through the injected mock device.
 */
function makeCanvas(): HTMLCanvasElement {
  return document.createElement('canvas')
}

function newEngine(): Engine {
  return new Engine({ canvas: makeCanvas(), gpuDevice: new MockGfxDevice() })
}

/** Emit a frame to drive one reconcile. */
function frame(engine: Engine): void {
  engine.events.emit('frame', { time: 0, dt: 0, frameNum: 1 })
}

/** Mount a fresh root element attached to the document. */
function mount(engine: Engine): HTMLElement {
  const root = document.createElement('div')
  document.body.appendChild(root)
  engine.a11y.mount(root)
  return root
}

describe('AccessibilityTree', () => {
  let engine: Engine

  beforeEach(() => {
    engine = newEngine()
  })
  afterEach(() => {
    engine.destroy()
    document.body.replaceChildren()
  })

  it('is a lazy, idempotent getter', () => {
    expect(engine.a11y).toBe(engine.a11y)
  })

  it('holds registrations until a mount, then builds the tree', () => {
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    const h = engine.a11y.attach(node, { role: 'button', label: 'Go' })
    frame(engine) // no mount yet: nothing in the document
    expect(document.querySelector('button')).toBeNull()

    const root = mount(engine)
    frame(engine)
    const btn = root.querySelector('button')
    expect(btn).not.toBeNull()
    expect(btn?.getAttribute('aria-label')).toBe('Go')
    expect(h.element).toBe(btn)
  })

  it('patches attributes in place, preserving element identity and focus', () => {
    const root = mount(engine)
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    const h = engine.a11y.attach(node, { role: 'button', label: 'Go' })
    frame(engine)
    const btn = h.element

    h.update({ label: 'Stop' })
    frame(engine)
    expect(h.element).toBe(btn) // same reference
    expect(btn.getAttribute('aria-label')).toBe('Stop')
    expect(root.querySelectorAll('button')).toHaveLength(1)
  })

  it('replaces the element when the role changes', () => {
    const root = mount(engine)
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    const h = engine.a11y.attach(node, { role: 'button', label: 'X' })
    frame(engine)

    h.update({ role: 'heading', headingLevel: 2, label: 'Title' })
    frame(engine)
    expect(root.querySelector('button')).toBeNull()
    const h2 = root.querySelector('h2')
    expect(h2?.textContent).toBe('Title')
    expect(h.element).toBe(h2)
  })

  it('nests cells under a grid and applies roving tabindex', () => {
    const root = mount(engine)
    const board = new SceneNode('board')
    const c0 = new SceneNode('c0')
    const c1 = new SceneNode('c1')
    engine.scene.root.add(board)
    board.add(c0)
    board.add(c1)
    engine.a11y.attach(board, { role: 'grid', label: 'Board' })
    engine.a11y.attach(c0, { role: 'gridcell', label: 'A' })
    engine.a11y.attach(c1, { role: 'gridcell', label: 'B' })
    frame(engine)

    const grid = root.querySelector('[role="grid"]')
    expect(grid).not.toBeNull()
    const cells = grid!.querySelectorAll('[role="gridcell"]')
    expect(cells).toHaveLength(2)
    // One tab stop, siblings removed from tab order.
    expect(cells[0].getAttribute('tabindex')).toBe('0')
    expect(cells[1].getAttribute('tabindex')).toBe('-1')
  })

  it('activates via a delegated click', () => {
    const root = mount(engine)
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    let activated = 0
    const h = engine.a11y.attach(node, {
      role: 'button',
      label: 'Go',
      onActivate: () => activated++,
    })
    frame(engine)
    h.element.dispatchEvent(new Event('click', { bubbles: true }))
    expect(activated).toBe(1)
    void root
  })

  it('fires focus/blur callbacks via delegation', () => {
    mount(engine)
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    let focused = false
    const h = engine.a11y.attach(node, {
      role: 'button',
      label: 'Go',
      onFocus: () => (focused = true),
      onBlur: () => (focused = false),
    })
    frame(engine)
    h.element.dispatchEvent(new Event('focusin', { bubbles: true }))
    expect(focused).toBe(true)
    h.element.dispatchEvent(new Event('focusout', { bubbles: true }))
    expect(focused).toBe(false)
  })

  it('activates a non-native widget on Enter', () => {
    mount(engine)
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    let activated = 0
    const h = engine.a11y.attach(node, {
      role: 'checkbox',
      label: 'Toggle',
      onActivate: () => activated++,
    })
    frame(engine)
    h.element.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }),
    )
    expect(activated).toBe(1)
  })

  it('moves focus between roving members on arrow keys', () => {
    const root = mount(engine)
    const board = new SceneNode('board')
    const c0 = new SceneNode('c0')
    const c1 = new SceneNode('c1')
    engine.scene.root.add(board)
    board.add(c0)
    board.add(c1)
    engine.a11y.attach(board, { role: 'grid', label: 'Board' })
    engine.a11y.attach(c0, { role: 'gridcell', label: 'A' })
    engine.a11y.attach(c1, { role: 'gridcell', label: 'B' })
    frame(engine)

    const cells = root.querySelectorAll<HTMLElement>('[role="gridcell"]')
    const spy = vi.spyOn(cells[1], 'focus')
    cells[0].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    )
    expect(spy).toHaveBeenCalledOnce()
  })

  it('emits relationship attributes for links', () => {
    const root = mount(engine)
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    engine.a11y.attach(node, {
      role: 'button',
      label: 'Help',
      links: [{ relation: 'controls', target: '#pause-menu' }],
    })
    frame(engine)
    expect(root.querySelector('button')?.getAttribute('aria-controls')).toBe(
      'pause-menu',
    )
  })

  it('announces into the matching live region', () => {
    const root = mount(engine)
    engine.a11y.announce('Red wins', 'assertive')
    const region = root.querySelector('[aria-live="assertive"]')
    expect(region?.textContent).toBe('Red wins')
  })

  it('prunes on detach and on node destroy', () => {
    const root = mount(engine)
    const a = new SceneNode('a')
    const b = new SceneNode('b')
    engine.scene.root.add(a)
    engine.scene.root.add(b)
    const ha = engine.a11y.attach(a, { role: 'button', label: 'A' })
    engine.a11y.attach(b, { role: 'button', label: 'B' })
    frame(engine)
    expect(root.querySelectorAll('button')).toHaveLength(2)

    ha.detach()
    frame(engine)
    expect(root.querySelectorAll('button')).toHaveLength(1)

    b.destroy()
    frame(engine)
    expect(root.querySelectorAll('button')).toHaveLength(0)
  })

  it('empties the tree when a scene swap destroys its nodes', () => {
    const root = mount(engine)
    for (const id of ['a', 'b', 'c']) {
      const n = new SceneNode(id)
      engine.scene.root.add(n)
      engine.a11y.attach(n, { role: 'button', label: id })
    }
    frame(engine)
    expect(root.querySelectorAll('button')).toHaveLength(3)

    for (const child of engine.scene.root.children.slice()) child.destroy()
    frame(engine)
    expect(root.querySelectorAll('button')).toHaveLength(0)
  })

  it('toggles inert for modal handling', () => {
    const root = mount(engine)
    engine.a11y.setInert(true)
    expect(root.getAttribute('aria-hidden')).toBe('true')
    engine.a11y.setInert(false)
    expect(root.getAttribute('aria-hidden')).toBeNull()
  })

  it('clears the mount on dispose', () => {
    const root = mount(engine)
    const node = new SceneNode('n1')
    engine.scene.root.add(node)
    engine.a11y.attach(node, { role: 'button', label: 'Go' })
    frame(engine)
    expect(root.children.length).toBeGreaterThan(0)

    engine.destroy()
    expect(root.children.length).toBe(0)
  })

  describe('node.a11y() chainable sugar', () => {
    it('registers a node already in the scene', () => {
      const root = mount(engine)
      const node = new SceneNode('n1')
      engine.scene.root.add(node)
      const ret = node.a11y({ role: 'button', label: 'Go' })
      expect(ret).toBe(node) // chainable
      frame(engine)
      expect(root.querySelector('button')?.getAttribute('aria-label')).toBe(
        'Go',
      )
    })

    it('defers registration until the node joins a scene', () => {
      const root = mount(engine)
      const node = new SceneNode('n1').a11y({ role: 'button', label: 'Go' })
      frame(engine)
      expect(root.querySelector('button')).toBeNull() // not in a scene yet

      engine.scene.root.add(node)
      frame(engine)
      expect(root.querySelector('button')?.getAttribute('aria-label')).toBe(
        'Go',
      )
    })

    it('merges on a second call and patches in place', () => {
      const root = mount(engine)
      const node = new SceneNode('n1')
      engine.scene.root.add(node)
      node.a11y({ role: 'button', label: 'Mute', states: { pressed: false } })
      frame(engine)
      const btn = root.querySelector('button')!
      expect(btn.getAttribute('aria-pressed')).toBe('false')

      node.a11y({ label: 'Unmute', states: { pressed: true } })
      frame(engine)
      expect(root.querySelector('button')).toBe(btn) // same element
      expect(btn.getAttribute('aria-label')).toBe('Unmute')
      expect(btn.getAttribute('aria-pressed')).toBe('true')
    })
  })
})

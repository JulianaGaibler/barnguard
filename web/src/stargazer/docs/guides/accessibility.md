---
title: Accessibility
group: Features
order: 18
---

# Accessibility

A screen reader can't read what Stargazer draws on a `<canvas>`, and a keyboard can't reach it. The accessibility layer adds a hidden HTML tree that mirrors the scene nodes you describe. A screen reader reads that tree, and a keyboard moves through it and activates its controls.

You describe a node with {@link Semantics}: a role, a label and optional state. The engine creates one hidden HTML element per described node inside a mount element that you provide. Your scene and its drawing don't change. The layer is reached as `engine.a11y`, an {@link AccessibilityTree}, and only exists once you use it. An engine that never touches `engine.a11y` creates no elements.

The layer works on {@link Node2D} nodes.

## Basic usage

Give the engine a mount element right after the canvas, then describe a node. In Svelte, the {@link a11yRoot} action mounts the element:

```svelte
<main style="position: relative">
  <canvas use:mountEngine={{ onReady }}></canvas>
  <div use:a11yRoot={{ engine: host.engine }}></div>
</main>
```

Then add semantics to a node with [`node.a11y()`](/module/scene/node2d#a11y):

```ts
import { ShapeNode } from '@src/stargazer'

const startButton = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 64 },
  fill: '#3a7',
}).a11y({
  role: 'button',
  label: 'Start game',
  onActivate: () => startGame(),
})
startButton.bindPointer({ down: () => startGame() })
panel.add(startButton)
```

The hidden tree gets a `<button>` with the name "Start game". A screen reader announces it, Tab moves focus to it, and Enter, Space or a click calls `onActivate`. `.a11y()` doesn't change how the shape draws or handles touch.

### Mount the hidden root

The mount element must be an element your app owns. Put it where its reading order next to the canvas is right, usually the next sibling after the `<canvas>`. The engine gives it a style that hides it on screen but keeps it readable for screen readers.

Without Svelte, call [`engine.a11y.mount(element)`](/module/a11y/accessibilitytree#mount). The engine builds the tree only after it has a mount element. You can describe nodes before or after you mount.

### Describe a node

There are two ways to describe a node:

- `node.a11y(semantics)` returns the node, so it chains with `setVisible()` and `setHitEnabled()`. If the node is not in a scene yet, the engine registers it when it joins one.
- [`engine.a11y.attach(node, semantics)`](/module/a11y/accessibilitytree#attach) registers the node at once and returns a {@link SemanticsHandle}.

```ts
const cell = engine.a11y.attach(cellNode, {
  role: 'gridcell',
  label: 'Column 1, row 1, empty',
  posInSet: 1,
  setSize: 42,
  onActivate: () => dropPiece(0),
  onFocus: () => focusRing.show(cellNode),
  onBlur: () => focusRing.hide(cellNode),
})
```

`onActivate` runs on a click and on Enter or Space while the element has focus. `onFocus` and `onBlur` run when keyboard focus enters and leaves the element. Use them to draw a focus ring on the canvas. `bindPointer` returns an unbind function, not the node, so call it on its own line.

A destroyed node leaves the hidden tree by itself. Nodes you don't describe are not in the tree, so decorative content needs no work.

### Change the description

Call `node.a11y()` again with only the fields that changed. The engine merges them into the current semantics and updates the existing element. Focus stays where it is, and the screen reader doesn't announce the whole element again.

```ts
muteNode.a11y({
  role: 'button',
  label: 'Mute',
  states: { pressed: false }, // a toggle button, sets aria-pressed
  onActivate: toggleMute,
})

// When the state changes:
muteNode.a11y({ label: 'Unmute', states: { pressed: true } })
```

With a handle, call [`update`](/module/a11y/semanticshandle#update) the same way. [`detach`](/module/a11y/semanticshandle#detach) removes the node from the hidden tree.

### Nested nodes

The hidden tree follows the scene tree, but only described nodes appear in it. A node you don't describe, such as a background or a layout container, leaves no element. Its described children move up under the nearest described ancestor. Take this menu:

```
panel          (Node2D)
├─ background  (ShapeNode)   decorative
├─ titleText   (TextNode)
└─ buttonRow   (Node2D)      layout only
   ├─ startButton   (ShapeNode)
   └─ optionsButton (ShapeNode)
```

Describe the four nodes that carry meaning:

```ts
const panel = new Node2D().a11y({ role: 'group', label: 'Main menu' })
const titleText = new TextNode({ text: 'Welcome' }).a11y({
  role: 'heading',
  headingLevel: 1,
  label: 'Welcome',
})
const startButton = new ShapeNode({ geometry }).a11y({
  role: 'button',
  label: 'Start game',
  onActivate: startGame,
})
const optionsButton = new ShapeNode({ geometry }).a11y({
  role: 'button',
  label: 'Options',
  onActivate: openOptions,
})
panel.add(background, titleText, buttonRow)
buttonRow.add(startButton, optionsButton)
```

The engine creates this hidden HTML. `background` and `buttonRow` have no element, and the buttons sit directly under the panel:

```html
<div role="group" aria-label="Main menu">
  <h1>Welcome</h1>
  <button>Start game</button>
  <button>Options</button>
</div>
```

Children read in the order the scene draws them. To change the order among siblings, set `order` on their semantics. Lower values come first, and the default is `0`.

### Keyboard navigation

Each control outside a composite role is its own Tab stop. A composite role, `grid`, `radiogroup`, `listbox` or `toolbar`, is a single Tab stop. Inside it, the arrow keys move focus between its members:

- Right and Down move to the next member.
- Left and Up move to the previous member.
- Home and End move to the first and last member.
- Focus wraps from the last member to the first, and back.

A board of 42 cells is therefore one Tab stop, not 42. The arrow keys follow reading order, so in a `grid`, Down moves to the next cell, not to the cell below.

### Announce events

For messages that don't belong to a node, such as "Your turn", use [`announce`](/module/a11y/accessibilitytree#announce). It writes into a live region that the screen reader reads.

```ts
engine.a11y.announce('Red played column 3') // waits for a pause
engine.a11y.announce('Red wins!', 'assertive') // interrupts
```

The same message twice in a row is announced twice.

## Advanced usage

This section lists every semantics field and role, and covers links to HTML overlays, modal dialogs and how the hidden tree updates.

### Semantics fields

A {@link Semantics} object takes these fields. Only `role` is required.

| Field             | HTML result                                                                      |
| ----------------- | -------------------------------------------------------------------------------- |
| `role`            | The element and its `role`. See the next section.                                |
| `label`           | `aria-label`, or the text content for `heading` and `status`                     |
| `description`     | `aria-description`                                                               |
| `roleDescription` | `aria-roledescription`, which changes how the role is announced                  |
| `value`           | `aria-valuenow` when it is a number, or the text content for `status`            |
| `valueText`       | `aria-valuetext`, a readable form of `value`, or the text content for `status`   |
| `live`            | `aria-live`, so the element announces its own changes                            |
| `disabled`        | `aria-disabled="true"`                                                           |
| `states`          | `aria-checked`, `aria-selected`, `aria-pressed`, `aria-expanded`, `aria-current` |
| `headingLevel`    | `<h1>` to `<h6>` for `role: 'heading'`. The default is `<h2>`.                   |
| `posInSet`        | `aria-posinset`, starting at 1                                                   |
| `setSize`         | `aria-setsize`                                                                   |
| `order`           | Reading order among siblings. The default is `0`.                                |
| `links`           | Relationship attributes to other HTML. See below.                                |
| `onActivate`      | Called on click, and on Enter or Space while focused                             |
| `onFocus`         | Called when the element gets focus                                               |
| `onBlur`          | Called when the element loses focus                                              |

`disabled` only sets `aria-disabled`. The engine still calls `onActivate`, so check the disabled state in your handler. `states.current` also takes `'page'`, `'step'` or `'location'`.

### Roles

An {@link A11yRole} decides which element the engine creates:

- `button` creates a `<button>`. The browser handles Enter and Space for it.
- `heading` creates `<h1>` to `<h6>`, with `label` as its text.
- `link` creates an `<a>` with `role="link"`.
- Every other role creates a `<div>` with that `role`: `checkbox`, `radio`, `group`, `grid`, `gridcell`, `row`, `radiogroup`, `listbox`, `option`, `toolbar`, `region`, `application` and `status`.

The roles `button`, `checkbox`, `radio`, `link`, `gridcell` and `option` can take focus. A node with any other role also takes focus when it has an `onActivate`. A focusable element that is not a `<button>` gets Enter and Space handling from the engine.

A `status` element shows `valueText`, `value` or `label` as its text, in that order of preference. Changing the role replaces the element. Every other change updates the existing element.

### Link to HTML overlays

HTML overlays attached with `domAnchor` are normal HTML, so screen readers can already read them. They stay in their own part of the page and are not merged into the hidden tree. To connect a canvas node to an overlay, add a link. Each relation maps to one attribute:

- `controls` sets `aria-controls`.
- `labelledBy` sets `aria-labelledby`.
- `describedBy` sets `aria-describedby`.
- `details` sets `aria-details`.
- `flowTo` sets `aria-flowto`.

```ts
engine.a11y.attach(helpButtonNode, {
  role: 'button',
  label: 'How to play',
  links: [{ relation: 'controls', target: '#help-panel' }],
  onActivate: openHelp,
})
```

An {@link A11yLink} `target` is an id string, with or without `#`, or an `HTMLElement`. Prefer the id string, so the engine changes nothing in your own HTML. An element without an id gets one assigned. An id that is not in the page yet, such as an overlay inside an `{#if}` block, still works. The browser resolves it when the element appears. Several links with the same relation share one attribute.

The layer doesn't use `aria-owns` to merge the overlay into the tree, because then reading order and focus order would differ.

### Modal dialogs

When your app opens a dialog, hide the hidden tree from screen readers and from Tab with [`setInert(true)`](/module/a11y/accessibilitytree#setinert). It sets `inert` and `aria-hidden` on the mount element. Call `setInert(false)` when the dialog closes.

```ts
function openPause() {
  engine.a11y.setInert(true)
  pauseDialog.focus()
}
function closePause() {
  engine.a11y.setInert(false)
}
```

### How the hidden tree updates

The engine rebuilds the hidden tree on the engine's `frame` event, and only when something changed. These calls mark it as changed:

- `attach`, `node.a11y()` or `update`
- `detach`, or the destruction of a described node
- `mount`

Node positions don't matter to a screen reader, so a still scene costs nothing per frame. The engine moves existing elements instead of creating new ones, and restores focus after a rebuild, so an update never moves focus to the page body.

The layer doesn't watch the scene tree itself. If you move a described node to another parent or reorder siblings, the hidden tree shows the new order at the next rebuild, which any of the calls above starts. Nodes in the primary scene read first, then nodes in other stages' scenes.

`engine.destroy()` disposes the layer, which removes its elements from the mount element.

### Things to watch

Keep these points in mind:

- Reading order across the page follows DOM order. Put the mount element right after the canvas, and app overlays after that.
- Use `role: 'application'` only on a small part that needs raw arrow keys, never on the whole page. It turns off the screen reader's reading mode.
- Use `roleDescription` rarely, because it replaces the role name the user knows.
- Automated checks such as axe-core find wrong structure and attributes. Check reading order and announcements with a real screen reader, such as NVDA, VoiceOver or TalkBack.

## See also

- {@link AccessibilityTree}: the hidden tree, reached as `engine.a11y`
- {@link Semantics}: the description of one node
- {@link SemanticsHandle}: update or detach a described node
- {@link A11yRole}: the supported roles
- {@link A11yLink}: links to HTML outside the hidden tree
- {@link a11yRoot}: the Svelte action that mounts the hidden root
- [HTML overlays](/guides/html-overlays): HTML elements pinned to scene nodes
- [Input](/guides/input): pointer handling with `bindPointer`

# Accessibility

Everything stargazer draws lives on a `<canvas>`, which is opaque to assistive
technology. For a touchscreen kiosk that is fine. For an interactive website it
is not: a screen reader sees nothing, and there is no keyboard navigation.

The accessibility layer fixes this without changing how you build scenes. You
attach optional semantics (role, label, state) to the scene nodes that matter,
and the engine mirrors them into a hidden HTML tree a screen reader can read and
a keyboard can drive. It is entirely opt-in: an engine that never touches
`engine.a11y` allocates nothing and adds no DOM, so a kiosk pays no cost.

## The shape

- Register a node with `engine.a11y.attach(node, semantics)`. The subsystem
  keeps a registry of these nodes — the scene tree itself is untouched.
- Each registered node becomes a real, hidden HTML element (`<button>`, a
  heading, a `role="gridcell"` div, …) inside a mount element you provide. The
  elements nest by scene hierarchy and read in scene (painter) order.
- Nodes with no semantics are absent from the tree, so decorative content is
  hidden by simply not registering it.
- The mirror rebuilds only when something changes (a handle `update`, an
  attach/detach, or a node destroy), never per frame — screen readers ignore
  position, so a static scene reconciles zero times.

## Mounting the hidden root

The subsystem needs an element to fill. It must be one your app owns, placed
where its reading order relative to the canvas is correct — a sibling right
after the `<canvas>`. From Svelte, use the `a11yRoot` action; the engine makes
the element visually hidden but screen-reader readable:

```svelte
<main class="stage" style="position: relative">
  <canvas use:mountEngine={{ onReady }}></canvas>
  <div use:a11yRoot={{ engine: host.engine }}></div>
</main>
```

Without Svelte, call `engine.a11y.mount(element)` directly.

## Describing nodes

```ts
// A landmark group for the whole board.
engine.a11y.attach(boardNode, { role: 'grid', label: 'Connect Four board' })

// Each cell is a focusable, activatable gridcell.
const cell = engine.a11y.attach(cellNode, {
  role: 'gridcell',
  label: 'Column 1, row 1, empty',
  posInSet: 1,
  setSize: 42,
  onActivate: () => dropDisc(0),
  onFocus: () => focusRing.show(cellNode),
  onBlur: () => focusRing.hide(cellNode),
})

// State changes go through the handle; the element is patched in place.
cell.update({ label: 'Column 1, row 1, red', states: { selected: true } })
```

`onActivate` fires on click and on Enter/Space when focused. `onFocus` /
`onBlur` let you draw a focus ring on the canvas in response to keyboard focus.

There are two ways to register the same thing: the imperative
`engine.a11y.attach(node, …)` shown above, and a chainable `node.a11y(…)` that
reads well when you build the node — used below.

## Upgrading a node

Making a node accessible is purely additive — you don't restructure the scene or
touch how the node draws. Take a start button that today only handles touch:

```ts
const startBtn = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 64 },
  fill: '#3a7',
})
startBtn.bindPointer({ down: () => startGame() })
panel.add(startBtn)
```

Upgrade it by chaining `.a11y(...)` onto the node. The drawing and the pointer
handler stay exactly as they were; this just adds a hidden `<button>` that a
screen reader announces and a keyboard activates, reusing the same handler:

```ts
const startBtn = new ShapeNode({
  geometry: { kind: 'rect', width: 240, height: 64 },
  fill: '#3a7',
}).a11y({
  role: 'button',
  label: 'Start game',
  onActivate: () => startGame(), // the same thing the tap does
})
startBtn.bindPointer({ down: () => startGame() })
panel.add(startBtn)
```

`.a11y()` returns the node, so it composes with the other chainable setters
(`.setVisible()`, `.setHitEnabled()`, `.setRenderLayer()`). `bindPointer` is the
exception — it returns an unbind function, so call it separately. Registration
is deferred until the node joins a scene, so `.a11y()` on a freshly-built node is
fine. Nothing about the visual node, its transform, or its touch behavior
changes.

## Changing a11y info

Update by calling `.a11y()` again with only the fields that changed — it merges
into the current semantics and patches the existing element in place, so focus
and screen-reader state survive (no re-announcement of the whole node). A mute
toggle, for example:

```ts
muteNode.a11y({
  role: 'button',
  label: 'Mute',
  states: { pressed: false }, // a toggle button → aria-pressed
  onActivate: toggleMute,
})

// on toggle — merges, patched in place:
muteNode.a11y({ label: 'Unmute', states: { pressed: true } })
```

The imperative equivalent is `handle.update(...)` on the handle returned by
`engine.a11y.attach(...)`.

## Nested nodes

You register only the nodes that carry meaning. The hidden tree follows the
scene hierarchy, but **unregistered nodes collapse out** — a decorative
background or a pure layout container leaves no trace, and its registered
descendants reattach to the nearest registered ancestor. So a menu built like
this:

```
panel        (SceneNode)
├─ background (ShapeNode)   ← decorative
├─ titleText  (TextNode)
└─ buttonRow  (SceneNode)   ← pure layout wrapper
   ├─ startBtn   (ShapeNode)
   └─ optionsBtn (ShapeNode)
```

is made accessible by describing just the four meaningful nodes as you build
them (and `add` takes as many children as you like):

```ts
const panel = new SceneNode().a11y({ role: 'group', label: 'Main menu' })
const titleText = new TextNode({ text: 'Barn Guard' }).a11y({
  role: 'heading',
  headingLevel: 1,
  label: 'Barn Guard',
})
const startBtn = new ShapeNode({ geometry }).a11y({
  role: 'button',
  label: 'Start game',
  onActivate: startGame,
})
const optionsBtn = new ShapeNode({ geometry }).a11y({
  role: 'button',
  label: 'Options',
  onActivate: openOptions,
})
panel.add(background, titleText, buttonRow)
buttonRow.add(startBtn, optionsBtn)
```

which the engine mirrors into this hidden HTML — note that `background` and
`buttonRow` are gone, and the buttons sit directly under the panel:

```html
<div role="group" aria-label="Main menu">
  <h1>Barn Guard</h1>
  <button>Start game</button>
  <button>Options</button>
</div>
```

Children read in scene (painter) order; nudge a sibling with `order` on its
semantics if you need a different order than the tree gives. To turn the buttons
into a single arrow-navigable tab stop, give `panel` a composite role
(`toolbar`, `radiogroup`, …) instead of `group` — see below.

## Keyboard navigation

Independent controls are natural tab stops. A composite role — `grid`,
`radiogroup`, `listbox`, `toolbar` — becomes a **single** tab stop whose members
rove with the arrow keys (and Home/End), so a 42-cell board is one stop, not 42.
Native `<button>`s activate on Enter/Space for free; other widgets are activated
by the subsystem.

## Announcing events

Transient events that aren't tied to a node — "your turn", "Red wins" — go
through a live region:

```ts
engine.a11y.announce('Red played column 3') // polite
engine.a11y.announce('Red wins!', 'assertive') // interrupts
```

## Linking to HTML overlays

Real overlay HTML (a pause menu, a HUD) built as `domAnchor` elements is already
natively accessible and lives in its own DOM. The two trees stay **separate** —
they are not merged. To connect them for the screen reader, point a canvas
node's proxy at the overlay with a relationship link (rendered as
`aria-controls` / `aria-labelledby` / `aria-describedby` / `aria-details` /
`aria-flowto`):

```ts
engine.a11y.attach(helpButtonNode, {
  role: 'button',
  label: 'How to play',
  links: [{ relation: 'controls', target: '#help-panel' }],
  onActivate: openHelp,
})
```

Prefer a stable id string (the overlay already has one), so no app-owned DOM is
mutated. An id that isn't in the DOM yet — an overlay behind `{#if}` — is fine;
the browser resolves it once the element mounts. This is deliberately **not**
`aria-owns`: reparenting into one tree diverges from focus order and is fragile
across screen readers.

## Modal overlays

When an app-owned dialog opens, hide the game region from assistive tech and
trap focus in the dialog, then restore on close:

```ts
function openPause() {
  engine.a11y.setInert(true) // game region: inert + aria-hidden
  pauseDialog.focus()
}
function closePause() {
  engine.a11y.setInert(false)
}
```

## Things to watch

- Cross-region reading order follows DOM order. Keep the a11y root right after
  the canvas and app overlays after that.
- Use `role: 'application'` only on a composite subtree that needs raw arrow
  keys, never the whole page — it suppresses the screen reader's browse mode.
- `roleDescription` overrides how AT announces the role; use it sparingly.
- Automated checks (axe-core, keyboard) catch structure and attribute bugs, but
  verify reading order and announcements with a real screen reader (NVDA,
  VoiceOver, TalkBack).

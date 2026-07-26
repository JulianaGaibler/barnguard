# Layout

Layout is opt-in. By default you place a node by setting `transform.x`/`transform.y`, and that is the right tool for game entities. Reach for layout when a group of nodes should fill the window and reflow on resize, a menu, a HUD, a panel, instead of sitting at fixed coordinates.

The model is constraints-based, the same idea as Flutter and SwiftUI: constraints flow down, sizes flow up, and each parent places its children. You build a tree of containers, hand it to a `LayoutRoot`, and the engine measures and arranges it into the visible area, then again on every resize. Nothing here runs until you attach a `LayoutRoot`.

## A first layout

```ts
import {
  LayoutRoot,
  Column,
  Row,
  Expanded,
  Box,
  edgeInsets,
} from '@src/stargazer'

const root = new LayoutRoot()
root.setContent(
  new Column({
    gap: 16,
    crossAxisAlign: 'stretch',
    children: [
      titleBar, // a node you built
      new Expanded({ child: body }), // takes the height left over
      footer,
    ],
  }),
)
host.engine.tree.root.add(root)
```

The root fills the camera's visible world rect by default, so the content tracks the canvas as it resizes. To pin the content to a fixed region instead of the live view, pass `bounds`:

```ts
new LayoutRoot({ bounds: () => myRegionRect })
```

## Row and Column

`Row` lays children out left to right, `Column` top to bottom. Inflexible children take their natural size; `gap` spaces them; `mainAxisAlign` distributes the leftover space along the main axis and `crossAxisAlign` places each child on the other axis.

```ts
new Row({
  gap: 12,
  crossAxisAlign: 'center',
  children: [avatar, label, badge],
})
```

`mainAxisAlign` is one of `start`, `center`, `end`, `spaceBetween`, `spaceAround`, `spaceEvenly`. `crossAxisAlign` is `start`, `center`, `end`, or `stretch`.

To make a child grow, wrap it in `Expanded`; several expanded children split the leftover space by their `flex` weight. `Spacer` is flexible empty space, handy for pushing siblings apart.

```ts
new Row({
  children: [
    logo,
    new Spacer(), // pushes the button to the right edge
    playButton,
  ],
})

new Row({
  children: [
    new Expanded({ child: left, flex: 2 }), // two thirds
    new Expanded({ child: right, flex: 1 }), // one third
  ],
})
```

`Flexible` is the looser cousin of `Expanded`: it may end up smaller than its share, where `Expanded` always fills it.

## Boxes and spacing

`Box` is a single-child container with an optional fixed size and padding; it stretches its child to fill the padded interior. `SizedBox` and `Padding` are the common shortcuts.

```ts
new Box({ width: 480, padding: edgeInsets(24), child: content })
new SizedBox({ width: 96, height: 96, child: icon })
new Padding({ insets: edgeInsets(8, 16), child: label }) // 8 vertical, 16 horizontal
```

`edgeInsets(all)`, `edgeInsets(vertical, horizontal)`, and `edgeInsets(top, right, bottom, left)` cover the usual cases.

## Placing a child in a larger area

`Align` fills the space its parent offers and places one child within it; `Center` is the centered shorthand.

```ts
new Center({ child: board })
new Align({ alignX: 'end', alignY: 'start', child: closeButton })
```

`AspectRatio` fits the largest box of a given width/height ratio inside the offered space and aligns the child in it. A ratio of 1 keeps a board square as the window changes shape.

```ts
new AspectRatio({ ratio: 1, child: board })
```

## Stack and Scaffold

`Stack` overlays its children in one box, painted back to front, each placed by the stack's alignment. `Scaffold` is the page frame: an optional header, a content area that fills the space between, and an optional footer.

```ts
new Stack({
  alignX: 'end',
  alignY: 'start',
  children: [thumbnail, unreadBadge],
})

new Scaffold({
  header: titleBar,
  content: new Center({ child: board }),
  footer: toolbar,
})
```

## Using your own nodes

A `ShapeNode` already knows its size, so it drops straight into a layout:

```ts
new Row({
  children: [
    new ShapeNode({ geometry: { kind: 'circle', radius: 12 } }),
    label,
  ],
})
```

To make a custom node layout-aware, implement `Measurable`, a preallocated `measuredSize`, a `measure(constraints)` that returns it, and an `arrange(x, y, w, h)` that sets `transform.x`/`transform.y`. Extending `LayoutNode` gives you the `measuredSize` field and `markLayoutDirty()` for free; see its API reference for a worked example.

## Opting out: freeform content in a layout

Not everything under a `LayoutRoot` has to be laid out. There are two ways to keep content freeform, positioned by its own `transform`, while the tree around it reflows.

The first is to add a node that is not `Measurable` to a `Row`, `Column`, or `Stack`. Those containers lay out their measurable children and leave the rest alone: a plain `Node2D` sibling still draws, culls, and hit-tests, but the layout does not size or move it, so it stays wherever its own `transform` puts it.

The second is `LayoutBuilder`, for when freeform content still needs to know the box it should fill, a physics field, a grid drawn from its own geometry, a `domAnchor`ed overlay. It takes a slot like any other node but, instead of laying out a subtree, reports the rect it was arranged into. The rect is in world coords, so content living elsewhere in the scene can read it directly.

```ts
const field = new LayoutBuilder({ onLayout: (rect) => board.fit(rect) })
root.setContent(
  new Center({ child: new AspectRatio({ ratio: 1, child: field }) }),
)
```

A `LayoutBuilder` sizes like a flex child: it fills a tight box (what a `LayoutRoot`, `AspectRatio`, or `Expanded` hands it) and otherwise measures to the minimum, which is 0 under a loose box. A bare builder on the main axis of a `Row` or `Column` therefore collapses to nothing; wrap it in `Expanded`, `AspectRatio`, or `SizedBox` to give it size. `board.fit` decides what to do with the rect: fit once, or reflow on resize. A game mid-match might store the rect for later and skip an expensive rebuild until the next round.

## Updating a layout

Constructor props seed the tree once. To change it later, mutate through the container's methods rather than rebuilding, which reuses the existing node instances so their running tweens and state survive:

```ts
row.add(child)
row.insert(1, child)
row.remove(child)
row.setChildren([a, b, c])
box.setChild(child)
```

Each call schedules one coalesced layout pass on the next frame. Rebuilding the tree from scratch (`new Column({ children: [...] })` again) instead throws away the old nodes and everything attached to them, so prefer the methods.

## Animating

Animate transforms, not layout. A transform tween (`x`, `y`, `scaleX`, `scaleY`) is free: it never triggers a layout pass. Changing a layout size does trigger one, so to make something pop, tween `scaleX`/`scaleY` rather than a width:

```ts
await card.tween({ scaleX: 1.1, scaleY: 1.1 }, { duration: 0.15 })
```

## Limits

- Bounded axes and flex. A `Row`/`Column` with an `Expanded` or `Spacer` child needs a bounded size on its main axis so there is space to divide. A flex child under an unbounded axis throws a named error rather than growing forever; give the container a size (a `LayoutRoot` always does).
- Text. Layout does not measure text, so it cannot size a label to its content. Wrap the label in a `SizedBox` with an explicit size, or place it manually.
- One measure pass. Sizing comes from the constraints plus content in a single pass; intrinsic sizing (a column that sizes to its widest label) is not supported.
- No scrolling or clipping. Content that overflows its box is not clipped.
- A `LayoutBuilder` reports a rect but does not size to whatever content reads it. Freeform content placed from that rect lives outside the root's subtree, so a `LayoutRoot` will not invalidate its static bake; if it draws on the static layer, call `scene.invalidateStatic()` yourself when the rect changes.

## Where to go next

- [Scene graph](/guides/scene), the `Node2D` tree layout builds on
- [Camera](/guides/camera), the viewport whose visible rect a `LayoutRoot` fills
- [Animation](/guides/animation), `tween` and the abort contract
